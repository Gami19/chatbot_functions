// Brave Web API + LLM for deep research 
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { MENUS } from '../types';  // MEMUSをインポート

// 環境変数の取得
const workspacesConfig = JSON.parse(process.env.WORKSPACES || '{}');

// --- 型定義 ---
interface DeepResearchRequestBody {
  workspaceId: string;
  model?: string; 
  messages: { role: string; content: string }[];
  scrapePages?: boolean;
  maxScrapePages?: number;
  maxScrapeLength?: number;
  iterations?: number;
}

// モデル情報取得関数
const getModelInfo = (modelName: string, workspaceId: string) => {
  const model = MENUS.find(menu => menu.value === modelName);
  
  if (!model || model.category.type !== 'model') {
    return { 
      model: modelName,
      maxTokens: 65536  // モデル情報がない場合のみのデフォルト値
    };
  }
  
  const maxTokens = model.category.maxTokens || 65536; // カテゴリにmaxTokensがない場合の予備
  
  return {
    model: model.category.modelId || modelName,
    maxTokens: maxTokens
  };
};

/**
 * BraveSearchクラス - Brave検索APIのラッパー
 */
class BraveWebSearch {
  private apiKey: string;
  private braveEndpoint: string;

  constructor(apiKey: string, braveEndpoint: string) {
    this.apiKey = apiKey;
    this.braveEndpoint = braveEndpoint;
  }

  async search(query: string, count: number = 5): Promise<any> {
    const headers = {
      "Accept": "application/json",
      "X-Loc-Country": "JP",
      "X-Subscription-Token": this.apiKey,
      "Accept-Encoding": "gzip",
      "Accept-Language": "ja-JP,ja;q=0.9",
    };

    try {
      const params = new URLSearchParams({
        q: query,
        search_lang: "jp",
        country: "jp",
        count: count.toString()
      });

      const response = await fetch(`${this.braveEndpoint}?${params.toString()}`, {
        method: 'GET',
        headers: headers
      });

      if (!response.ok) {
        throw new Error(`HTTP検索エラー: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error("検索エラー:", error);
      return null;
    }
  }
}

/**
 * ウェブページをスクレイピングする関数（cheerioを使わないバージョン）
 */
async function scrapeWebpage(url: string, maxScrapeLength: number): Promise<string> {
    try {
      const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7"
      };
  
      const response = await fetch(url, { headers });
      
      if (!response.ok) {
        return `HTTPエラー発生: ${response.status} - URL: ${url}`;
      }
      
      const html = await response.text();
      
      // HTML要素からテキストを抽出する簡易的なパーサー
      let cleanedText = html
        // スクリプトタグを削除
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
        // スタイルタグを削除
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
        // その他不要なタグを削除（nav, footer, header, aside, iframe, noscript）
        .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, " ")
        .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, " ")
        .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, " ")
        .replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, " ")
        .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, " ")
        .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ")
        // HTMLタグを削除
        .replace(/<[^>]*>/g, " ")
        // 特殊文字をデコード
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        // 複数の空白を1つにまとめる
        .replace(/\s+/g, " ");
        
      // さらにテキストを整形
      const lines = cleanedText.split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0);
      
      let text = lines.join('\n');
      
      // 長いテキストを制限
      if (text.length > maxScrapeLength) {
        text = text.substring(0, maxScrapeLength) + "...(省略)";
      }
      
      return text;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return `スクレイピングがタイムアウトしました: ${url}`;
      }
      return `スクレイピングエラー: ${error instanceof Error ? error.message : String(error)} - URL: ${url}`;
    }
  }

/**
 * 複数のウェブページを並行してスクレイピングする関数
 */
async function parallelScrapeWebpages(urls: string[], titles: string[], maxScrapeLength: number): Promise<any[]> {
  const results = [];
  
  // 最大5並列で実行
  const batchSize = 5;
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const batchTitles = titles.slice(i, i + batchSize);
    
    const promises = batch.map(async (url, index) => {
      try {
        const content = await scrapeWebpage(url, maxScrapeLength);
        return {
          url: url,
          title: batchTitles[index],
          content: content
        };
      } catch (error) {
        console.error(`ページ ${url} の処理中にエラー:`, error);
        return null;
      }
    });
    
    const batchResults = await Promise.all(promises);
    results.push(...batchResults.filter(result => result !== null));
  }
  
  return results;
}

/**
 * LLMの出力から次の検索トピックを抽出する関数
 */
function extractNextSearchTopic(llmOutput: string): string | null {
  try {
    // JSONブロックを抽出する正規表現
    const jsonMatch = llmOutput.match(/```json\s*([\s\S]*?)\s*```/);
    let jsonStr;
    
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    } else {
      // JSONブロックが見つからない場合は、全体をJSONとして解析を試みる
      jsonStr = llmOutput;
    }
    
    // 不要な文字を取り除く
    jsonStr = jsonStr.trim();
    
    // JSON形式に変換
    const data = JSON.parse(jsonStr);
    
    // nextSearchTopicの値を取り出す
    return data.nextSearchTopic;
  } catch (error) {
    console.error("nextSearchTopic抽出エラー:", error);
    return null;
  }
}

/**
 * LLMの出力から検索を続けるかどうかを抽出する関数
 */
function extractShouldContinue(llmOutput: string): boolean {
  try {
    // JSONブロックを抽出する正規表現
    const jsonMatch = llmOutput.match(/```json\s*([\s\S]*?)\s*```/);
    let jsonStr;
    
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    } else {
      // JSONブロックが見つからない場合は、全体をJSONとして解析を試みる
      jsonStr = llmOutput;
    }
    
    // 不要な文字を取り除く
    jsonStr = jsonStr.trim();
    
    // JSON形式に変換
    const data = JSON.parse(jsonStr);
    
    // shouldContinueの値を取り出す（デフォルトはTrue）
    let shouldContinue = data.shouldContinue;
    
    // 文字列の場合はブール値に変換
    if (typeof shouldContinue === 'string') {
      shouldContinue = ['true', 'yes', '1'].includes(shouldContinue.toLowerCase());
    }
    
    return shouldContinue !== false;
  } catch (error) {
    console.error("shouldContinue抽出エラー:", error);
    return true;
  }
}

/**
 * 多様な検索結果を確保する関数
 */
function ensureDiverseResults(newResults: any, previousUrls: Set<string>): [any[], Set<string>] {
  if (!newResults || !newResults.web || !newResults.web.results) {
    return [[], previousUrls];
  }
  
  const diverseResults = [];
  
  for (const result of newResults.web.results) {
    const url = result.url;
    if (url && !previousUrls.has(url)) {
      diverseResults.push(result);
      previousUrls.add(url);
    }
  }
  
  return [diverseResults, previousUrls];
}

/**
 * 検索結果をフォーマットする関数
 */
async function formatSearchResults(
  results: any,
  scrapePages: boolean,
  maxScrapePages: number,
  maxScrapeLength: number,
  previousUrls: Set<string> = new Set()
): Promise<[string, any[], Set<string>]> {
  if (!results || !results.web || !results.web.results) {
    return ["検索結果が見つかりませんでした。", [], previousUrls];
  }
  
  // 多様な結果を確保
  const [diverseResults, updatedPreviousUrls] = ensureDiverseResults(results, previousUrls);
  
  if (diverseResults.length === 0) {
    return ["新しい検索結果が見つかりませんでした。", [], updatedPreviousUrls];
  }
  
  const formattedResults = [];
  const urlsToScrape = [];
  const titlesToScrape = [];
  
  for (let i = 0; i < diverseResults.length; i++) {
    const result = diverseResults[i];
    const title = result.title || 'タイトルなし';
    const description = result.description || '説明なし';
    const url = result.url || 'URLなし';
    
    const formattedResult = `【${i + 1}】\nタイトル: ${title}\n内容: ${description}\nURL: ${url}\n`;
    formattedResults.push(formattedResult);
    
    // スクレイピング対象のURLとタイトルを収集
    if (scrapePages && i < maxScrapePages) {
      urlsToScrape.push(url);
      titlesToScrape.push(title);
    }
  }
  
  // 並行してスクレイピング
  let scrapedContents = [];
  if (urlsToScrape.length > 0) {
    console.log(`  ${urlsToScrape.length}ページを並行スクレイピング中...`);
    scrapedContents = await parallelScrapeWebpages(urlsToScrape, titlesToScrape, maxScrapeLength);
  }
  
  return [formattedResults.join('\n'), scrapedContents, updatedPreviousUrls];
}

/**
 * レポートをきれいにする関数
 */
function cleanReport(reportText: string): string {
  // 連続する重複行を削除
  const lines = reportText.split('\n');
  const cleanLines = [];
  let prevLine = null;
  
  for (const line of lines) {
    if (line !== prevLine) {
      cleanLines.push(line);
      prevLine = line;
    }
  }
  
  // 重複した見出しを修正
  let text = cleanLines.join('\n');
  text = text.replace(/(### [^#\n]+)\n\1/g, '$1');
  
  // 参考文献セクションが複数ある場合は最初のものだけ残す
  const refRegex = /(### 参考文献[\s\S]*?)(?=###|\Z)/g;
  const refs = [...text.matchAll(refRegex)];
  
  if (refs.length > 1) {
    const firstRef = refs[0][0];
    const refItemRegex = /(\d+\.\s+\[[\s\S]*?\][\s\S]*?)(?=\d+\.\s+\[|\Z)/g;
    const refItems = [...firstRef.matchAll(refItemRegex)].map(match => match[0]);
    
    const uniqueRefs = [];
    const seenUrls = new Set();
    
    // URLが重複しない参考文献項目だけを保持
    for (const item of refItems) {
      const urlMatch = item.match(/\]\((https?:\/\/[^\)]+)\)/);
      if (urlMatch) {
        const url = urlMatch[1];
        if (!seenUrls.has(url)) {
          uniqueRefs.push(item);
          seenUrls.add(url);
        }
      } else {
        uniqueRefs.push(item);
      }
    }
    
    // 整形された参考文献セクション
    const cleanRefSection = "### 参考文献\n" + uniqueRefs.join('');
    
    // レポートの他の部分と組み合わせる
    const parts = text.split(firstRef, 2);
    text = parts[0] + cleanRefSection;
    
    // 最後のセクションがあれば追加
    if (parts.length > 1 && parts[1].includes("### ")) {
      const lastSectionMatch = parts[1].match(/(###[\s\S]*)/);
      if (lastSectionMatch) {
        text += "\n\n" + lastSectionMatch[0];
      }
    }
  }
  
  return text;
}

/**
 * トークン数を管理する関数
 */
function manageTokenUsage(findingsText: string, detailedContent: string, maxTokens: number): [string, string] {
  // 簡易的なトークン数推定（英語で約4文字＝1トークン、日本語はより多い）
  const estimatedTokens = findingsText.length / 4 + detailedContent.length / 4;
  
  if (estimatedTokens > maxTokens * 0.7) {  // 70%以上で削減
    // スクレイプしたコンテンツを短くする
    const contentParts = detailedContent.split("---\n\n");
    const shortenedParts = [];
    
    const maxLengthPerPart = 1000;
    for (const part of contentParts) {
      if (part) {
        const shortened = part.substring(0, maxLengthPerPart) + "...(省略)";
        shortenedParts.push(shortened);
      }
    }
    
    detailedContent = shortenedParts.join("---\n\n");
    
    // それでも長すぎる場合はさらに削減
    if ((findingsText.length / 4 + detailedContent.length / 4) > maxTokens * 0.7) {
      // 検索結果を要約版に
      const parts = findingsText.split("### 検索トピック");
      const shortenedFindings = [parts[0]];  // 最初の部分は保持
      
      // 各検索トピックの最初の結果だけを保持
      for (let i = 1; i < parts.length; i++) {
        const topicPart = parts[i];
        const firstResult = topicPart.split("【2】")[0];
        shortenedFindings.push(firstResult + "...(他の結果は省略)");
      }
      
      findingsText = shortenedFindings.join("### 検索トピック");
    }
  }
  
  return [findingsText, detailedContent];
}

/**
 * Azure OpenAI APIを呼び出す関数
 */
async function callAzureOpenAI(
  workspaceId: string,
  modelName: string,
  messages: any[],
  context: InvocationContext
): Promise<any> {
  try {
    // ワークスペース設定を取得
    const workspaceConfig = workspacesConfig[workspaceId];
    
    if (!workspaceConfig) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }

    // モデル情報を取得
    const modelInfo = getModelInfo(modelName, workspaceId);
    const model = modelInfo.model;
    const maxTokensToSend = modelInfo.maxTokens;

    // Azure OpenAI APIのエンドポイントとAPIキーを取得
    const { azureOpenaiEndpoint: endpoint, azureOpenaiApiKey: apiKey, azureOpenaiApiVersion: apiVersion } = workspaceConfig;

    context.log(`Using model: ${model} (from ${modelName})`);

    const response = await fetch(
      `${endpoint}openai/deployments/${model}/chat/completions?api-version=${apiVersion}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKey
        },
        body: JSON.stringify({ 
          messages,
          max_tokens: maxTokensToSend
        })
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Azure OpenAI API request failed: ${errorBody}`);
    }

    return await response.json();
  } catch (error) {
    context.log('Error in callAzureOpenAI:', error);
    throw error;
  }
}

export async function deepResearch(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log(`Http function processed request for url "${request.url}"`);

  try {
    // リクエストボディからパラメータを取得
    const requestBody = await request.json() as unknown as DeepResearchRequestBody;

    
    // 必須パラメータのチェック
    const workspaceId = requestBody?.workspaceId;
    if (!workspaceId) {
      return { status: 400, body: "Request body must contain a 'workspaceId' field." };
    }
    
    // 設定値の取得とデフォルト値の設定
    const model = requestBody?.model || "o1-mini";
    const scrapePages = requestBody?.scrapePages ?? true;
    const maxScrapePages = requestBody?.maxScrapePages ?? 3;
    const maxScrapeLength = requestBody?.maxScrapeLength ?? 3000;
    const maxIterations = requestBody?.iterations ?? 3;
    
    // リクエストボディからメッセージ配列を取得し、最後のユーザーメッセージを検索クエリとする
    const userMessages = requestBody?.messages?.filter((msg: { role: string; }) => msg.role === 'user');
    if (!userMessages || userMessages.length === 0) {
      return { status: 400, body: "Request body must contain a 'messages' array with at least one user message." };
    }
    const initialQuery = userMessages[userMessages.length - 1].content;
    
    if (!initialQuery) {
      return { status: 400, body: "The user message content is empty." };
    }
    
    // API設定の取得
    const braveApiKey = process.env.BRAVE_API_KEY;
    const braveEndpoint = process.env.BRAVE_ENDPOINT;
    
    if (!braveApiKey || !braveEndpoint) {
      context.log("ERROR: Brave API Key or Endpoint is not set in environment variables.");
      return { status: 500, body: "Server configuration error." };
    }
    
    // クライアントの初期化
    const braveClient = new BraveWebSearch(braveApiKey, braveEndpoint);
    
    // 調査情報の初期化
    let currentQuery = initialQuery;
    let iterationsDone = 0;
    let allFindings = [];
    let scrapedData = [];
    let searchedTopics = [currentQuery];
    let previousUrls = new Set<string>();
    
    context.log(`調査トピック: ${initialQuery}`);
    context.log(`最大繰り返し回数: ${maxIterations}`);
    context.log(`使用モデル: ${model}`);
    context.log(`ウェブスクレイピング: ${scrapePages ? '有効' : '無効'}`);
    if (scrapePages) {
        context.log(`最大スクレイピングページ数: ${maxScrapePages}`);
        context.log(`最大スクレイピング長: ${maxScrapeLength}`);
    }
    
    // 調査のメインループ
    while (iterationsDone < maxIterations) {
      iterationsDone++;
      context.log(`\n--- 調査ラウンド ${iterationsDone}/${maxIterations} ---`);
      context.log(`現在の検索クエリ: ${currentQuery}`);
      
      // Brave Search APIで検索実行
      const searchResults = await braveClient.search(currentQuery);
      if (!searchResults) {
        context.log("検索結果が取得できませんでした。");
        break;
      }
      
      // 検索結果のフォーマットとスクレイピング
      const [formattedResults, currentScrapedData, updatedPreviousUrls] = 
        await formatSearchResults(searchResults, scrapePages, maxScrapePages, maxScrapeLength, previousUrls);
      
      allFindings.push({ "query": currentQuery, "results": formattedResults });
      scrapedData = [...scrapedData, ...currentScrapedData];
      previousUrls = updatedPreviousUrls;
      
      context.log(`検索結果を取得しました（${searchResults.web?.results?.length || 0}件）`);
      if (scrapePages) {
        context.log(`スクレイピングしたページ数: ${currentScrapedData.length}件`);
      }
      
      // 全ての検索結果とトピックをまとめる
      let allResultsText = "";
      for (let i = 0; i < allFindings.length; i++) {
        const finding = allFindings[i];
        allResultsText += `### 検索トピック ${i + 1}: ${finding.query}\n`;
        allResultsText += finding.results + "\n\n";
      }
      
      // プロンプト内のプレースホルダーを置換
      const researchPrompt = `You are a research agent investigating the following topic.
What have you found? What questions remain unanswered? What specific aspects should be investigated next?

## User's Query
${initialQuery}

## Current Findings
${allResultsText}

## Searched Topics
${searchedTopics.join(", ")}

## Output
- Do not output topics that are exactly the same as already searched topics.
- If further information search is needed, set nextSearchTopic.
- If sufficient information has been obtained, set shouldContinue to false.
- Please output in json format

\`\`\`json
{
  "nextSearchTopic": "next search query or null if done",
  "shouldContinue": true or false
}
\`\`\``;
      
      // モデルに分析を依頼
      const responseData = await callAzureOpenAI(workspaceId, model, [
        { "role": "user", "content": researchPrompt }
      ], context);
      
      // 分析結果を受け取り
      const analysisResult = responseData.choices[0].message.content;
      
      // 次の検索トピックを取得
      const nextTopic = extractNextSearchTopic(analysisResult);
      const shouldContinue = extractShouldContinue(analysisResult);
      
      // 検索を続けるかどうか
      if (!shouldContinue) {
        context.log("検索は完了しました。十分な情報が集まりました。");
        break;
      }
      
      // 次の検索トピックが取得できなかった場合はデフォルトトピックを使用
      if (!nextTopic) {
        currentQuery = `${initialQuery} 追加情報`;
        context.log(`次の検索トピックが見つからなかったため、デフォルトトピック「${currentQuery}」を使用します。`);
      } else {
        currentQuery = nextTopic;
      }
      
      searchedTopics.push(currentQuery);
    }
    
    context.log(`調査が完了しました（${iterationsDone}回の検索を実行）。`);
    
    // 全ての検索結果をまとめる
    let allFindingsText = "";
    for (let i = 0; i < allFindings.length; i++) {
      const finding = allFindings[i];
      allFindingsText += `### 検索トピック ${i + 1}: ${finding.query}\n`;
      allFindingsText += finding.results + "\n\n";
    }
    
    // スクレイピングしたデータを組み込んだコンテンツを作成
    let detailedContent = "";
    if (scrapedData.length > 0) {
      for (let i = 0; i < scrapedData.length; i++) {
        const pageData = scrapedData[i];
        detailedContent += `\n## スクレイピングしたコンテンツ ${i + 1}: ${pageData.title}\n`;
        detailedContent += `URL: ${pageData.url}\n\n`;
        detailedContent += `${pageData.content}\n\n`;
        detailedContent += "---\n\n";
      }
    }
    
    // トークン管理
    const effectiveMaxTokens = getModelInfo(model, workspaceId).maxTokens;
    [allFindingsText, detailedContent] = manageTokenUsage(allFindingsText, detailedContent, effectiveMaxTokens);
    
    // 最終レポート用プロンプト
    const finalPrompt = `Based on the investigation results, create a comprehensive analysis of the topic.
Provide important insights, conclusions, and remaining uncertainties. Cite sources where appropriate. This analysis should be very comprehensive and detailed. It is expected to be a long text.

## Topic
${initialQuery}

## Search Results
${allFindingsText}

## Detailed Page Contents
${detailedContent}

日本語で答えてください。レポートは明確に構成し、重複した内容や参考文献の繰り返しを避けてください。
ウェブページのコンテンツを分析に十分に活用してください。情報源を適切に引用してください。
`;
    
    // 最終レポート生成
    const finalResponseData = await callAzureOpenAI(workspaceId, model, [
      { "role": "user", "content": finalPrompt }
    ], context);
    
    // レポートを受け取り、整形する
    const finalReport = cleanReport(finalResponseData.choices[0].message.content);
    
    // レポートの先頭にメタデータを追加
    const reportWithMetadata = `# ${initialQuery} - 調査レポート

${finalReport}`;
    
    return {
      status: 200,
      jsonBody: {
        searchResults: scrapePages 
          ? scrapedData.map((item, index) => ({
              index: index + 1,
              title: item.title,
              description: item.content.substring(0, 150) + "...",
              url: item.url
            }))
          : allFindings.flatMap((finding, findingIndex) => {
              // 検索結果から情報を抽出
              const results = finding.results.split('【').filter(part => part.trim().length > 0);
              return results.map(result => {
                const titleMatch = result.match(/タイトル: (.*?)(?:\n|$)/);
                const contentMatch = result.match(/内容: (.*?)(?:\n|$)/);
                const urlMatch = result.match(/URL: (.*?)(?:\n|$)/);
                return {
                  index: findingIndex + 1,
                  title: titleMatch ? titleMatch[1] : '不明',
                  description: contentMatch ? contentMatch[1] : '説明なし',
                  url: urlMatch ? urlMatch[1] : '#'
                };
              });
            }),
        answer: finalReport,
        query: initialQuery,
        searchTerm: searchedTopics.join(", ")
      },
      headers: {
        "Content-Type": "application/json"
      }
    };
  } catch (error) {
    context.log("ERROR: Error processing request:", error);
    if (error instanceof SyntaxError) {
      return { 
        status: 400, 
        jsonBody: {
          error: "Invalid JSON format in request body."
        }
      };
    }
    return { 
      status: 500, 
      jsonBody: {
        error: `Internal Server Error: ${error instanceof Error ? error.message : String(error)}`
      }
    };
  }
}

app.http('deepResearch', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: deepResearch
});