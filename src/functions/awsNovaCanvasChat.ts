import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { logRequest } from '../logger';

// AWS SDK imports for Bedrock
import { BedrockRuntimeClient,InvokeModelCommand} from "@aws-sdk/client-bedrock-runtime";
import { MENUS } from '../types';

// 型定義
interface ChatMessage {
    role: 'system' | 'developer' | 'user' | 'assistant';
    content: string;
    negativecontent:string;
}

interface ChatRequestBody {
    workspaceId: string;
    model: string;
    messages: ChatMessage[];
    image?: {  // 画像データ用の型を追加
        media_type: string;
        data: string;
    };
    video?: {  // 動画データ用の型を追加
        media_type: string;
        data: string;
    };
    tasktype?: string; // 背景削除、Outpainting、etc
    maskimage?:{
        media_type: string;
        data: string;
    };
    maskprompt?: string;
}

// 環境変数の取得
const workspacesConfig = JSON.parse(process.env.WORKSPACES || '{}');

// Bedrockモデル情報取得関数
const getBedrockModelInfo = (modelName: string, workspaceId: string) => {
    const model = MENUS.find(menu => menu.value === modelName);
    const maxTokens = model?.category.type === 'model' ? model.category.maxTokens : 4096;
    if (!model || model.category.type !== 'model' || model.category.modelType !== 'bedrock') {
        const errorMessage = `不明なモデル名: ${modelName}`;
        throw new Error(errorMessage);
    }
    const workspaceConfig = workspacesConfig[workspaceId];
    if (!workspaceConfig) {
        const errorMessage = `ワークスペース情報が見つかりません: ${workspaceId}`;
        throw new Error(errorMessage);
    }
    const modelInfo = {
        model: model.category.modelId!,
        region: model.category.region!,
        maxTokens: maxTokens,
        accessKeyId: workspaceConfig.bedrockAccessKeyId,
        secretAccessKey: workspaceConfig.bedrockSecretAccessKey
    };
    return modelInfo;
};


// InvokeModel レスポンス用ヘルパー関数 (画像生成用)
// Amazon Nova Canvas のみ
const basic = async (bedrockRuntime: BedrockRuntimeClient, requestBody: any, bedrockModelInfo: any, context: InvocationContext) => {
    context.log('basic 関数が開始'); // basic 関数開始をログ出力
    try {
        context.log('Bedrock InvokeModel API リクエスト送信 :', bedrockModelInfo.model); // API リクエスト送信をログ出力

        // InvokeModel API を使用
        const command = new InvokeModelCommand({
            modelId: bedrockModelInfo.model,
            body: JSON.stringify(requestBody)
        });

        const response = await bedrockRuntime.send(command); // bedrockRuntime.send() でコマンドを実行
        if (!response.body) {
            throw new Error("No response body from Bedrock InvokeModel API");
        }

        const model_response = JSON.parse(response.body.transformToString());
        const base64_image_data = model_response["images"][0];

        const jsonResponse = {
            image: base64_image_data // Base64エンコードされた画像データをJSONに含める
        };

        // Base64エンコードされた画像データをJSONレスポンスとして返す
        return {
            headers: {
                'Content-Type': 'application/json', // Content-Type を application/json に変更
                'Cache-Control': 'no-cache'
            },
            jsonBody: jsonResponse
        };

    } catch (error: any) { // エラー型を any に変更 (ClientError を考慮)
        context.log('basic 関数でエラー発生 (画像生成):', error); // エラー発生をログ出力
        const errorDetails = error.message || 'Unknown error'; // エラー詳細メッセージを取得
        return {
            status: 500,
            jsonBody: {
                error: 'Internal server error in basic (image generation)',
                details: errorDetails // エラー詳細メッセージを設定
            }
        };
    }
};

export async function awsNovaCanvasChat(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    logRequest(context, 'awsNovaCanvasChat', request);
    context.log('awsNovaCanvasChat 関数が開始されました。'); // 関数開始をログ出力

    // リクエストボディを型付きで取得
    const requestBody = await request.json() as ChatRequestBody;
    const { workspaceId, model, messages, image, tasktype, maskimage, maskprompt } = requestBody;
    context.log('リクエストボディ:', requestBody); // リクエストボディの内容をログ出力

    // thinkingクエリパラメータを取得 (デフォルトはtrue)
    const thinkingParam = request.query.get('thinking');
    const enableThinking = thinkingParam !== 'false';
    context.log('thinking パラメータ:', thinkingParam, 'enableThinking:', enableThinking); // thinkingパラメータをログ出力

    try {
        // Bedrockモデル情報を取得
        context.log('getBedrockModelInfo 関数を呼び出し:', model, workspaceId);
        const bedrockModelInfo = getBedrockModelInfo(model, workspaceId);
        context.log('getBedrockModelInfo 関数から戻り値:', bedrockModelInfo.model);

        // AWS Bedrock clientの設定
        context.log('BedrockRuntimeClient を初期化:', bedrockModelInfo.region); // BedrockRuntimeClient 初期化をログ出力
        const bedrockRuntime = new BedrockRuntimeClient({
            region: bedrockModelInfo.region,
            credentials: {
                accessKeyId: bedrockModelInfo.accessKeyId,
                secretAccessKey: bedrockModelInfo.secretAccessKey
            }
        });

        // Bedrock APIリクエストの基本設定
        let requestBody: any;

        if (bedrockModelInfo.model === 'amazon.nova-canvas-v1:0') {
            context.log('Amazon Nova Canvas モデルを検出');

            // デフォルトは TEXT_IMAGE タスク
            if (tasktype === 'BACKGROUND_REMOVAL') {
                context.log('Amazon Nova Canvas 背景削除タスクを実行');

                if (!image) {
                    return {
                        status: 400,
                        jsonBody: { error: '画像データが必要です (背景削除)' }
                    };
                }

                requestBody = {
                    "taskType": "BACKGROUND_REMOVAL",
                    "backgroundRemovalParams": {
                        "image": image.data
                    }
                };

                context.log('Amazon Nova Canvas 背景削除リクエスト:', { modelId: bedrockModelInfo.model, ...requestBody }); // ログ出力

                return await basic(bedrockRuntime, requestBody, bedrockModelInfo, context); // basic 関数（without streaming response）を呼び出し
            
            // Outpainting　Inpainting
            } else if (tasktype === 'OUTPAINTING' || tasktype === 'INPAINTING') {
                const taskName = tasktype === 'OUTPAINTING' ? 'Outpainting' : 'Inpainting';
                context.log(`Amazon Nova Canvas ${taskName} タスクを実行`);

                const prompt = messages.filter(m => m.role !== 'system').map(m => m.content).join('\n');
                const negativeContent = messages
                    .filter(m => m.role !== 'system')
                    .map(m => m.negativecontent || '')
                    .filter(content => content !== '')
                    .join('\n');

                // in/outPaintingParams の基本構造を作成
                let paintingParams: any = {
                    "image": image.data,
                };
                   
                // maskPrompt または maskImage が必須
                if (maskprompt && maskimage && maskimage.data) {
                    return {
                        status: 400,
                        jsonBody: { error: 'maskPrompt と maskImage は同時に指定できません (' + taskName + ')' }
                    };
                } else if (maskprompt) {
                    paintingParams.maskPrompt = maskprompt;
                } else if (maskimage && maskimage.data) {
                    paintingParams.maskImage = maskimage.data;
                } else {
                    return {
                        status: 400,
                        jsonBody: { error: 'maskPrompt または maskImage のいずれかを指定してください (' + taskName + ')' }
                    };
                }
    
                // text が存在する場合のみ追加
                if (prompt && prompt.trim() !== '') {
                    paintingParams.text = prompt;
                }
                // negativeText が存在する場合のみ追加
                if (negativeContent && negativeContent.trim() !== '') {
                    paintingParams.negativeText = negativeContent;
                }

                if (tasktype === 'OUTPAINTING') {
                    paintingParams.outPaintingMode = "DEFAULT"; // Outpainting 固有のパラメータ
                }
    
                let native_request: any = {
                    "taskType": tasktype,
                    ...(tasktype === 'OUTPAINTING' ? { "outPaintingParams": paintingParams } : { "inPaintingParams": paintingParams }),
                    // 生成される画像のデフォルト
                    "imageGenerationConfig": {
                        "numberOfImages": 1,
                        "height": 512,
                        "width": 512,
                        "cfgScale": 8.0
                    }
                };
    
                if (!image) {
                    return {
                        status: 400,
                        jsonBody: { error: '画像データが必要です (' + taskName + ')' }
                    };
                }
    
                requestBody = native_request;
                context.log(`Amazon Nova Canvas ${taskName}リクエスト:`, { modelId: bedrockModelInfo.model, ...requestBody });
    
                return await basic(bedrockRuntime, requestBody, bedrockModelInfo, context);

            } else {
                 // デフォルトは TEXT_IMAGE タスク (画像生成)
                context.log('Amazon Nova Canvas TEXT TO IMAGETEXT TO IMAGEを実行');

                const prompt = messages.filter(m => m.role !== 'system').map(m => m.content).join('\n');
                const negativeContent = messages
                    .filter(m => m.role !== 'system')
                    .map(m => m.negativecontent || '')  // undefined の場合は空文字を返す
                    .filter(content => content !== '')  // 空文字をフィルタリング
                    .join('\n');

                const seed = Math.floor(Math.random() * 858993460);

                // textToImageParams の基本構造を作成
                let textToImageParams: any = {
                    "text": prompt
                };

                // negativeContent が存在する場合のみ追加
                if (negativeContent && negativeContent.trim() !== '') {
                    textToImageParams.negativeText = negativeContent;
                }
                
                let native_request: any = {
                    "taskType": "TEXT_IMAGE",
                    "textToImageParams": textToImageParams,
                    "imageGenerationConfig": {
                        "seed": seed,
                        "quality": "standard",
                        "height": 512,
                        "width": 512,
                        "numberOfImages": 1,
                    },
                };

                if (image && image.data) {
                    // 画像データが存在する場合、既存のパラメータを保持しつつ追加
                    native_request.textToImageParams = {
                        ...textToImageParams,
                        "conditionImage": image.data,
                        "controlMode": "CANNY_EDGE"
                    };
                }

                requestBody = native_request;

                context.log('Amazon Nova Canvas モデルへのリクエスト:', { modelId: bedrockModelInfo.model, ...requestBody }); // ログメッセージを修正

                return await basic(bedrockRuntime, requestBody, bedrockModelInfo, context); // basic 関数（without streaming response）を呼び出し
            }
        }

        // Bedrock APIリクエストを作成 (InvokeModelCommand を使用)
        console.log(requestBody)
        const command = new InvokeModelCommand({
            modelId: bedrockModelInfo.model,
            body: JSON.stringify(requestBody)
        });

        // ストリーミングレスポンスを取得
        context.log('Bedrock API リクエスト送信:', bedrockModelInfo.model); // API リクエスト送信をログ出力
        const response = await bedrockRuntime.send(command);
        context.log('Bedrock API レスポンス受信'); // API レスポンス受信をログ出力

        if (!response.body) {
            throw new Error("No response body from Bedrock");
        }


        context.log('image:', image); // リクエストボディの内容をログ出力

    } catch (error) {
        context.log('awsNovaCanvasChat 関数でエラー発生:', error); // エラー発生をログ出力
        return {
            status: 500,
            jsonBody: {
                error: 'Internal server error',
                details: error instanceof Error ? error.message : 'Unknown error'
            }
        };
    }
}

app.http('awsNovaCanvasChat', {
    methods: ['POST'],
    authLevel: 'function',
    handler: awsNovaCanvasChat
});