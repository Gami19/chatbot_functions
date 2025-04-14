import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { logRequest } from '../logger';

// AWS SDK imports for Bedrock
import { BedrockRuntimeClient,InvokeModelCommand, InvokeModelWithResponseStreamCommand, ConverseStreamCommand } from "@aws-sdk/client-bedrock-runtime";
import { Readable } from 'stream';
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
    tasktype?: string; //amazon nova canvas 使用するとき
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

// InvokeModelWithResponseStreamレスポンス用ヘルパー関数
const streamer = (stream: Readable, context: InvocationContext) => {
    return {
        [Symbol.asyncIterator]: async function* () {
            context.log('streamer async generator 関数が開始'); // streamer 関数開始をログ出力
            let usageMetadata: any = null;
            let inThinkingMode = false;
            let hasEmittedMetadata = false;
            let modelIsNovaMicro = false;
            let modelIsLlama = false; // Llamaモデルを判別するためのフラグ
            let modelIsDeepSeek = false; // DeepSeekモデルを判別するためのフラグ
            
            // ストリーム全体の try-catch ブロックを追加
            try {
                context.log('stream processing 開始'); // ストリーム処理開始をログ出力
                for await (const event of stream) {
                    try {

                        if (event && event.chunk) {
                            context.log('Chunk processing 開始:', event.chunk); // Chunk 処理開始をログ出力
                            // Nova Micro形式とAnthropic/AWS Bedrock形式で処理を分岐
                            if (event.chunk.bytes) {
                                context.log('Chunk type: bytes'); // Chunk タイプが bytes の場合をログ出力
                                context.log('Raw chunk data (bytes):', event.chunk.bytes); // Raw chunk data をログ出力
                                const jsonStr = Buffer.from(event.chunk.bytes).toString('utf-8');
                                context.log('JSON string (bytes):', jsonStr); // JSON string をログ出力
                                const content = JSON.parse(jsonStr);

                                // Nova のレスポンス形式を検出
                                if (content.metadata && content.metadata.usage) {
                                    context.log('Nova 形式を検出'); // Nova 形式検出をログ出力
                                    modelIsNovaMicro = true;
                                    usageMetadata = {
                                        input_tokens: content.metadata.usage.inputTokens,
                                        output_tokens: content.metadata.usage.outputTokens,
                                        total_tokens: content.metadata.usage.inputTokens + content.metadata.usage.outputTokens
                                    };
                                }

                                // Llamaのレスポンス形式を検出
                                if (content.generation !== undefined) {
                                    context.log('Llama 形式を検出'); // Llama 形式検出をログ出力
                                    modelIsLlama = true;
                                    // generationが空でない場合のみ送信
                                    if (content.generation && content.generation !== '\n\n') {
                                        yield `data: ${JSON.stringify({ content: content.generation })}\n\n`;
                                    }
                                }
                                // DeepSeekのレスポンス形式を検出
                                if (content.choices !== undefined) {
                                    context.log('DeepSeek 形式を検出'); // DeepSeek 形式検出をログ出力
                                    modelIsDeepSeek = true;
                                    if (content.choices && content.choices.length > 0 && content.choices[0].text) {
                                        // DeepSeekのレスポンスを choices[0].text 単位で送信

                                        yield `data: ${JSON.stringify({ content: content.choices[0].text })}\n\n`;
                                    }
                                }
                                // 新しいレスポンス形式（typeフィールドがある場合）
                                if ('type' in content) {
                                    context.log('新しいレスポンス形式 (type field)'); // 新しいレスポンス形式検出をログ出力
                                    // message_stop イベントの処理
                                    if (content.type === 'message_stop' && content['amazon-bedrock-invocationMetrics']) {
                                        // フォーマットを変換して保存
                                        const metrics = content['amazon-bedrock-invocationMetrics'];
                                        usageMetadata = {
                                            input_tokens: metrics.inputTokenCount,
                                            output_tokens: metrics.outputTokenCount,
                                            total_tokens: metrics.inputTokenCount + metrics.outputTokenCount
                                        };

                                        // ストリームの終わりまでメタデータ送信を延期
                                        continue;
                                    }
                                    // Content block delta の処理
                                    else if (content.type === 'content_block_delta' && 'delta' in content) {
                                        context.log('content_block_delta イベント'); // content_block_delta イベントをログ出力
                                        const delta = content.delta;

                                        // thinking content の処理
                                        if (delta.type === 'thinking_delta' && 'thinking' in delta) {
                                            // thinkingモードの開始時に<think>タグを送信
                                            if (!inThinkingMode) {
                                                inThinkingMode = true;
                                                yield `data: ${JSON.stringify({ content: '<think>' })}\n\n`;
                                            }
                                            // thinking contentを送信
                                            yield `data: ${JSON.stringify({ content: delta.thinking })}\n\n`;
                                            continue;
                                        }

                                        // text content の処理
                                        if (delta.type === 'text_delta' && 'text' in delta) {
                                            // thinkingモードから抜ける場合は</think>タグを送信
                                            if (inThinkingMode) {
                                                inThinkingMode = false;
                                                yield `data: ${JSON.stringify({ content: '</think>' })}\n\n`;
                                            }
                                            yield `data: ${JSON.stringify({ content: delta.text })}\n\n`;
                                        }
                                    }
                                }
                                // Nova Micro形式のcontentBlockDeltaを処理
                                else if (content.contentBlockDelta && content.contentBlockDelta.delta) {
                                    context.log('Nova contentBlockDelta 形式'); // Nova contentBlockDelta 形式をログ出力
                                    const delta = content.contentBlockDelta.delta;
                                    yield `data: ${JSON.stringify({ content: delta.text })}\n\n`;
                                }
                                // 元の形式の処理（後方互換性のため）
                                else if ('completion' in content) {
                                    context.log('旧形式 (completion field)'); // 旧形式 (completion field) をログ出力
                                    if (inThinkingMode) {
                                        inThinkingMode = false;
                                        yield `data: ${JSON.stringify({ content: '</think>' })}\n\n`;
                                    }
                                    for (const char of content.completion) {
                                        yield `data: ${JSON.stringify({ content: char })}\n\n`;
                                    }
                                }
                                // thinking処理（古い形式）
                                else if ('thinking' in content && content.thinking?.thinking) {
                                    context.log('旧形式 thinking 処理'); // 旧形式 thinking 処理をログ出力
                                    if (!inThinkingMode) {
                                        inThinkingMode = true;
                                        yield `data: ${JSON.stringify({ content: '<think>' })}\n\n`;
                                    }
                                    for (const char of content.thinking.thinking) {
                                        yield `data: ${JSON.stringify({ content: char })}\n\n`;
                                    }
                                }
                            }
                            // bytes以外の形式
                            else if (typeof event.chunk === 'string') {
                                context.log('Chunk type: string'); // Chunk タイプが string の場合をログ出力
                                context.log('Raw chunk data (string):', event.chunk); // Raw chunk data をログ出力
                                try {
                                    context.log('デフォルト（string）');
                                    const content = JSON.parse(event.chunk);
                                } catch (e) {
                                    context.log('JSON パースエラー (string chunk):', e); // JSON パースエラー (string chunk) をログ出力
                                    for (const char of event.chunk) {
                                        yield `data: ${JSON.stringify({ content: char })}\n\n`;
                                    }
                                }
                            }
                            context.log('Chunk processing 終了'); // Chunk 処理終了をログ出力
                        }
                    } catch (error) {
                        context.log('Chunk 処理エラー:', error); // Chunk 処理エラーをログ出力
                    }
                }
                context.log('stream processing 終了'); // ストリーム処理終了をログ出力
            } catch (error) {
                context.log('Stream エラー:', error); // Stream エラーをログ出力
                yield `data: ${JSON.stringify({ error: 'Stream error', details: error.message })}\n\n`; // エラーメッセージを送信
            }

            // thinkingモードが終了していない場合は、終了タグを送信
            if (inThinkingMode) {
                context.log('thinking モード終了タグ送信'); // thinking モード終了タグ送信をログ出力
                yield `data: ${JSON.stringify({ content: '</think>' })}\n\n`;
            }

            // 最後に空行を2行送信（理想の出力に合わせる）
            if (modelIsLlama || modelIsDeepSeek) {
                context.log('Llama または DeepSeek モデル, 空行送信 (modelIsLlama: ' + modelIsLlama + ', modelIsDeepSeek:' + modelIsDeepSeek + ')'); // Llama/DeepSeek モデルでの空行送信をログ出力
                yield `data: {"content":""}\n\n`;
            } else {
                context.log('空行送信 (Llama/DeepSeek 以外)'); // Llama/DeepSeek 以外の空行送信をログ出力
                yield `data: ${JSON.stringify({ content: "" })}\n\n`;
            }

            // ストリーム終了後にusage_metadataを送信（一度だけ）
            if (usageMetadata && !hasEmittedMetadata) {
                context.log('usage_metadata イベント送信:', usageMetadata); // usage_metadata イベント送信をログ出力
                hasEmittedMetadata = true;
                yield `event: usage_metadata\ndata: ${JSON.stringify(usageMetadata)}\n\n`;
            }
            context.log('streamer async generator 関数が終了'); // streamer 関数終了をログ出力
        }
    };
};

// Converse API レスポンス用ヘルパー関数 (ストリーミングAPIを使用)
const converser = async (bedrockRuntime: BedrockRuntimeClient, requestMessages: any, bedrockModelInfo: any, context: InvocationContext, inferenceConfig: any) => {
    context.log('converser 関数が開始 (ストリーミングAPI)'); // converser 関数開始をログ出力
    try {
        // Bedrock Converse API のメッセージ形式に合わせる (streamer関数と同様の処理)
        const messages = requestMessages.map((m: any) => ({
            role: m.role === 'developer' ? 'user' : m.role,
            content: m.content 
        }));

        context.log('Bedrock Converse API リクエスト送信 (ストリーミング):', bedrockModelInfo.model); // API リクエスト送信をログ出力

        // Converse Stream API を使用
        const command = new ConverseStreamCommand({
            modelId: bedrockModelInfo.model,
            messages: messages,
            inferenceConfig: inferenceConfig
        });

        const response = await bedrockRuntime.send(command); // bedrockRuntime.send() でコマンドを実行
        if (!response.stream) {
            throw new Error("No response stream from Bedrock Converse API");
        }

        // ストリーミングレスポンスを streamer 関数で処理
        return {
            headers: {
                'Content-Type': 'text/event-stream', // text/event-stream を指定
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            },
            body: streamer(response.stream as Readable, context) as any // streamer 関数を呼び出し、レスポンスストリームを渡す
        };

    } catch (error: any) { // エラー型を any に変更 (ClientError を考慮)
        context.log('converser 関数でエラー発生 (ストリーミングAPI):', error); // エラー発生をログ出力
        const errorDetails = error.message || 'Unknown error'; // エラー詳細メッセージを取得
        return {
            status: 500,
            jsonBody: {
                error: 'Internal server error in converser (streaming)',
                details: errorDetails // エラー詳細メッセージを設定
            }
        };
    }
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

export async function awsBedrockChat(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    logRequest(context, 'awsBedrockChat', request);
    context.log('awsBedrockChat 関数が開始されました。'); // 関数開始をログ出力

    // リクエストボディを型付きで取得
    const requestBody = await request.json() as ChatRequestBody;
    const { workspaceId, model, messages, image, video, tasktype } = requestBody;
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

        // システムプロンプトとユーザーメッセージを取得
        const systemPrompt = messages.find(m => m.role === 'system')?.content ||
            "あなたは日本語を話す優秀なアシスタントです。回答には必ず日本語で答えてください。";

        // Bedrock APIリクエストの基本設定
        let requestBody: any;

        // amazon nova micro（画像不可）
        if (bedrockModelInfo.model === 'us.amazon.nova-micro-v1:0') {
            const system_list = [{ "text": systemPrompt }];
            const message_list = messages
                .filter(m => m.role !== 'system')
                .map(m => ({
                    role: m.role === 'developer' ? 'user' : m.role,
                    content: [{ text: m.content }] // 画像処理を削除
                }));
            const inf_params = { "maxTokens": bedrockModelInfo.maxTokens, "temperature": 0.7, "topP": 0.9, "topK": 20 }; // topP, topK, temperature を追加

            requestBody = {
                schemaVersion: "messages-v1",
                messages: message_list,
                system: system_list,
                inferenceConfig: inf_params,
            };

            context.log('Amazon Nova Micro モデルへのリクエスト:', { modelId: bedrockModelInfo.model, ...requestBody }); // ログメッセージを修正

        // amazon nova lite, pro（画像あり、動画あり）
        }else if (bedrockModelInfo.model === 'us.amazon.nova-lite-v1:0' || bedrockModelInfo.model === 'us.amazon.nova-pro-v1:0') {
            const message_list = messages
                .filter(m => m.role !== 'system')
                .map(m => ({
                    role: m.role === 'developer' ? 'user' : m.role,
                    content: [
                        ...(image ? [{ //　画像データがある場合
                            image: {
                                format: image.media_type.split('/')[1],
                                source: { bytes: image.data }
                            }
                        }] : []),
                        ...(video ? [{  // 動画データがある場合
                            video: {
                                format: video.media_type.split('/')[1],
                                source: { bytes: video.data }
                            }
                        }] : []),
                        { text: m.content }
                    ]
                }));
            const inf_params = { "maxTokens": bedrockModelInfo.maxTokens, "temperature": 0.3 };

            requestBody = {
                schemaVersion: "messages-v1",
                messages: message_list,
                inferenceConfig: inf_params,
            };

            context.log('Amazon Nova Lite, Pro モデルへのリクエスト:', { modelId: bedrockModelInfo.model, ...requestBody }); // Amazon Nova リクエストをログ出力
        
        } 
        // Llama 3
        // Converse API を使用する場合
        else if (bedrockModelInfo.model === 'us.meta.llama3-2-90b-instruct-v1:0') {
            if (image) {
                // 画像がある場合は Converse API を使用
                context.log('Converse API (Llama 3.2 90B, 画像あり) を使用'); // Converse API 使用ログ
                const message_list = messages
                    .filter(m => m.role !== 'system')
                    .map(m => ({
                        role: m.role === 'developer' ? 'user' : m.role,
                        content: [
                            ...(image ? [{
                                image: {
                                    format: image.media_type.split('/')[1],
                                    source: { bytes: Buffer.from(image.data, 'base64') } // base64 デコード
                                }
                            }] : []),
                        ]
                    }));

                console.log();
                return await converser(bedrockRuntime, message_list, bedrockModelInfo, context, {
                    maxTokens: bedrockModelInfo.maxTokens,
                    temperature: 0.1,
                    topP: 0.9
                });  // converser 関数を呼び出し、bedrockRuntime を渡す (ストリーミングAPI版)
            } else {
                // 画像がない場合は streamer を使用 (以前の処理)
                context.log('Streamer (Llama 3.2 90B, 画像なし) を使用'); // Streamer 使用ログ
                const user_prompt = messages.filter(m => m.role !== 'system').map(m => m.content).join('\n');
                const formatted_prompt =
                    `< |begin_of_text|><|start_header_id|>system<|end_header_id|>\n` +
                    `${systemPrompt}< |eot_id|><|start_header_id|>user<|end_header_id|>\n` +
                    `${user_prompt}< |eot_id|><|start_header_id|>assistant<|end_header_id|>`;

                requestBody = {
                    prompt: formatted_prompt,
                    temperature: 0.5, // デフォルト値
                    max_gen_len: bedrockModelInfo.maxTokens,
                };
            }
        } else if (bedrockModelInfo.model === 'us.meta.llama3-3-70b-instruct-v1:0') {
            const user_prompt = messages.filter(m => m.role !== 'system').map(m => m.content).join('\n');
            const formatted_prompt =
                `< |begin_of_text|><|start_header_id|>system<|end_header_id|>\n` +
                `${systemPrompt}< |eot_id|><|start_header_id|>user<|end_header_id|>\n` +
                `${user_prompt}< |eot_id|><|start_header_id|>assistant<|end_header_id|>`;

            requestBody = {
                prompt: formatted_prompt,
                max_gen_len: bedrockModelInfo.maxTokens,
                temperature: 0.5,
            };

            context.log('Llama 3 モデルへのリクエスト:', { modelId: bedrockModelInfo.model, ...requestBody }); // Llama 3 リクエストをログ出力
        } else if (bedrockModelInfo.model === 'us.deepseek.r1-v1:0') {
            // const user_prompt = messages.filter(m => m.role !== 'system').map(m => m.content).join('\n');
            const formatted_prompt = `< ｜begin of sentence｜>${systemPrompt}<｜Assistant｜ >`;

            requestBody = {
                prompt: formatted_prompt,
                max_tokens: bedrockModelInfo.maxTokens,
                temperature: 0.2,
                top_p: 0.9,
            };

            context.log('DeepSeek-R1 モデルへのリクエスト:', { modelId: bedrockModelInfo.model, ...requestBody }); // DeepSeek-R1 リクエストをログ出力
        } else if (bedrockModelInfo.model === 'anthropic.claude-3-5-sonnet-20241022-v2:0' || bedrockModelInfo.model === 'us.anthropic.claude-3-7-sonnet-20250219-v1:0') {
            // システムプロンプトは messages に含めない
            const claudeMessages = messages
                .filter(m => m.role !== 'system')
                .map(m => {
                    if (m.role === 'user' && image) {
                        return {
                            role: 'user',
                            content: [
                                {
                                    type: "image",
                                    source: {
                                        type: "base64",
                                        media_type: image.media_type,
                                        data: image.data
                                    }
                                },
                                {
                                    type: "text",
                                    text: m.content
                                }
                            ]
                        };
                    }
                    return {
                        role: m.role === 'developer' ? 'user' : m.role,
                        content: m.content
                    };
                });

            requestBody = {
                anthropic_version: "bedrock-2023-05-31",
                max_tokens: bedrockModelInfo.maxTokens,
                messages: claudeMessages
            };

            //推論タグがある場合
            if (enableThinking) {
                Object.assign(requestBody, {
                    thinking: { type: "enabled", budget_tokens: 2000 }
                });
            }

            // システムプロンプトがある場合のみ追加
            if (systemPrompt) {
                requestBody.system = systemPrompt;
            }

            context.log('Claudeモデルへのリクエスト:', {
                modelId: bedrockModelInfo.model,
                messageCount: claudeMessages.length,
                hasImage: !!image,
                requestBody
            });
        } else {
            const claudeMessages = messages
                .filter(m => m.role !== 'system')
                .map(m => ({
                    role: m.role === 'developer' ? 'user' : m.role,
                    content: m.content
                }));

            requestBody = {
                anthropic_version: "bedrock-2023-05-31",
                max_tokens: bedrockModelInfo.maxTokens,
                system: systemPrompt,
                messages: claudeMessages
            };

            if (enableThinking) {
                Object.assign(requestBody, {
                    thinking: { type: "enabled", budget_tokens: 2000 }
                });
            }

            context.log('Bedrock (Claude) モデルへのリクエスト:', { modelId: bedrockModelInfo.model, enableThinking, ...requestBody }); // Bedrock (Claude) リクエストをログ出力
        }

        // Bedrock APIリクエストを作成 (InvokeModelWithResponseStreamCommand を使用)
        console.log(requestBody)
        const command = new InvokeModelWithResponseStreamCommand({
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

        // Llamaモデルかどうかを判定
        const modelIsLlama = bedrockModelInfo.model === 'us.meta.llama3-70b-instruct-v1:0';
        // Nova Microモデルかどうかを判定
        const modelIsNovaMicro = bedrockModelInfo.model === 'us.amazon.nova-micro-v1:0' || bedrockModelInfo.model === 'us.amazon.nova-lite-v1:0' || bedrockModelInfo.model === 'us.amazon.nova-pro-v1:0';

        context.log('image:', image); // リクエストボディの内容をログ出力

        // ストリーミングレスポンスを返す
        return {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            },
            body: streamer(response.body as Readable, context) as any
        };
    } catch (error) {
        context.log('awsBedrockChat 関数でエラー発生:', error); // エラー発生をログ出力
        return {
            status: 500,
            jsonBody: {
                error: 'Internal server error',
                details: error instanceof Error ? error.message : 'Unknown error'
            }
        };
    }
}

app.http('awsBedrockChat', {
    methods: ['POST'],
    authLevel: 'function',
    handler: awsBedrockChat
});