## 開発環境
> Azure Fuctions
> Next.js（ Node.js v18 ）

## ライブラリ
> npm install package.json

##　モデル（LLM）の追加方法
    1. src/types/index.ts　にモデル名,モデルID（AWS Bedrock/ AzureOpenai）,MaxTokenを追加
    2. AWS モデルを使う場合は,awsBedrockChat.ts（nova Canvas,ReelsはawsNovaCanvas.ts）にAPIを追加
    3. AzureOpenAIを使う場合は,azureOpenaiChat.tsにAPIを追加