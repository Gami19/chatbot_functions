export type Category =
  | {
    type: 'model';
    modelType: 'gpt' | 'bedrock';
    modelId?: string;
    region?: string;
    maxTokens?: number;
    cost?: {
      input: number;
      output: number;
    };
  }
  | {
    type: 'agent';
    toolType?: string;
  };

export type Menu = {
  value: string;
  assistantId?: string;
  prompt?: string;
  icon: string;
  displayName: string;
  description: string;
  category: Category;
  isImageUploadMenu: boolean;
  isAssistantsMenu?: boolean;
  instruction?: string;
};

// MENUSのデータを更新
export const MENUS: Menu[] = [
  {
    value: "gpt-4o",
    icon: '/azureOpenai_icon.png',
    displayName: "GPT-4o",
    description: "GPT-4oモデルとチャット",
    category: {
      type: "model",
      modelType: "gpt",
      region: "eastus",
      maxTokens: 4096,
      cost: { input: 0.0025, output: 0.010 }
    },
    isImageUploadMenu: true
  },
  {
    value: "gpt-4o-mini",
    icon: '/azureOpenai_icon.png',
    displayName: "GPT-4o mini",
    description: "GPT-4o miniモデルとチャット",
    category: {
      type: "model",
      modelType: "gpt",
      region: "eastus",
      maxTokens: 16384,
      cost: { input: 0.0015, output: 0.006 }
    },
    isImageUploadMenu: true
  },
  {
    value: "claude3-haiku",
    icon: '/bedrock_icon.png',
    displayName: "Claude 3 Haiku",
    description: "Claude 3 Haikuモデルとチャット",
    category: {
      type: "model",
      modelType: "bedrock",
      modelId: "anthropic.claude-3-haiku-20240307-v1:0",
      region: "us-west-2",
      maxTokens: 4096,
      cost: { input: 0.00025, output: 0.00125 }
    },
    isImageUploadMenu: true
  },
  {
    value: "claude35-haiku",
    icon: '/bedrock_icon.png',
    displayName: "Claude 3.5 Haiku",
    description: "Claude 3.5 Haikuモデルとチャット",
    category: {
      type: "model",
      modelType: "bedrock",
      modelId: "anthropic.claude-3-5-haiku-20241022-v1:0",
      region: "us-west-2",
      maxTokens: 4096,
      cost: { input: 0.0008, output: 0.004 }
    },
    isImageUploadMenu: false
  },
  {
    value: "claude35-sonnet",
    icon: '/bedrock_icon.png',
    displayName: "Claude 3.5 Sonnet（v1）",
    description: "Claude 3.5 Sonnet（v1）モデルとチャット",
    category: {
      type: "model",
      modelType: "bedrock",
      modelId: "anthropic.claude-3-5-sonnet-20240620-v1:0",
      region: "us-west-2",
      maxTokens: 4096,
      cost: { input: 0.003, output: 0.015 }
    },
    isImageUploadMenu: true
  },
  {
    value: "claude35-sonnet-v2",
    icon: '/bedrock_icon.png',
    displayName: "Claude 3.5 Sonnet（v2）",
    description: "Claude 3.5 Sonnet（v2）モデルとチャット",
    category: {
      type: "model",
      modelType: "bedrock",
      modelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      region: "us-west-2",
      maxTokens: 8192,
      cost: { input: 0.003, output: 0.015 }
    },
    isImageUploadMenu: true
  },
  {
    value: "claude37-sonnet-think",
    icon: '/bedrock_icon.png',
    displayName: "Claude 3.7 Sonnet（think）",
    description: "Claude 3.7 Sonnet（think）モデルとチャット",
    category: {
      type: "model",
      modelType: "bedrock",
      modelId: "us.anthropic.claude-3-7-sonnet-20250219-v1:0",
      region: "us-west-2",
      maxTokens: 64000,
      cost: { input: 0.003, output: 0.015 }
    },
    isImageUploadMenu: false
  },
  {
    value: "claude37-sonnet",
    icon: '/bedrock_icon.png',
    displayName: "Claude 3.7 Sonnet",
    description: "Claude 3.7 Sonnetモデルとチャット",
    category: {
      type: "model",
      modelType: "bedrock",
      modelId: "us.anthropic.claude-3-7-sonnet-20250219-v1:0",
      region: "us-west-2",
      maxTokens: 64000,
      cost: { input: 0.003, output: 0.015 }
    },
    isImageUploadMenu: false
  },
  {
    value: "amazon-nova-micro-v1",
    icon: '/bedrock_icon.png',
    displayName: "Amazon Nova Micro",
    description: "Amazon Nova Micro モデルとチャット",
    category: {
      type: "model",
      modelType: "bedrock",
      modelId: "us.amazon.nova-micro-v1:0",
      region: "us-west-2",
      maxTokens: 5000,
      cost: { input: 0.000035, output: 0.00014 }
    },
    isImageUploadMenu: false
  },
  {
    value: "amazon-nova-lite-v1",
    icon: '/bedrock_icon.png',
    displayName: "Amazon Nova Lite",
    description: "Amazon Nova Lite モデルとチャット",
    category: {
      type: "model",
      modelType: "bedrock",
      modelId: "us.amazon.nova-lite-v1:0",
      region: "us-west-2",
      maxTokens: 5000,
      cost: { input: 0.000060, output: 0.00024 }
    },
    isImageUploadMenu: false
  },
  {
    value: "amazon-nova-pro-v1",
    icon: '/bedrock_icon.png',
    displayName: "Amazon Nova Pro",
    description: "Amazon Nova Pro モデルとチャット",
    category: {
      type: "model",
      modelType: "bedrock",
      modelId: "us.amazon.nova-pro-v1:0",
      region: "us-west-2",
      maxTokens: 5000,
      cost: { input: 0.000800, output: 0.00320 }
    },
    isImageUploadMenu: false
  },
  {
    value: "amazon-nova-canvas",
    icon: '/bedrock_icon.png',
    displayName: "Amazon Nova Canvas",
    description: "Amazon Nova Canvas モデルと画像生成",
    category: {
      type: "model",
      modelType: "bedrock",
      modelId: "amazon.nova-canvas-v1:0",
      region: "us-east-1",
      maxTokens: 5000,
      cost: { input: 0.000800, output: 0.00320 }
    },
    isImageUploadMenu: false
  },
  {
    value: "llama3-1-405b-instruct",
    icon: '/bedrock_icon.png',
    displayName: "Llama 3.1 405B Instruct",
    description: "Llama 3.1 405B Instructモデルとチャット",
    category: {
      type: "model",
      modelType: "bedrock",
      modelId: "meta.llama3-1-405b-instruct-v1:0",
      region: "us-west-2",
      maxTokens: 4096,
      cost: { input: 0.0024, output: 0.0024 }
    },
    isImageUploadMenu: false
  },
  {
    value: "llama3-2-90b-instruct",
    icon: '/bedrock_icon.png',
    displayName: "Llama 3.2 90B Instruct",
    description: "Llama 3.2 90B Instructモデルとチャット",
    category: {
      type: "model",
      modelType: "bedrock",
      modelId: "us.meta.llama3-2-90b-instruct-v1:0",
      region: "us-west-2",
      maxTokens: 2048,
      cost: { input: 0.00072, output: 0.00072 }
    },
    isImageUploadMenu: false
  },
  {
    value: "llama-3-3-70b",
    icon: '/bedrock_icon.png',
    displayName: "Llama 3.3 70B",
    description: "Llama 3.3 70Bモデルとチャット",
    category: {
      type: "model",
      modelType: "bedrock",
      modelId: "us.meta.llama3-3-70b-instruct-v1:0",
      region: "us-west-2",
      maxTokens: 2048,
      cost: { input: 0.00072, output: 0.00072 }
    },
    isImageUploadMenu: false
  },
  {
    value: "deepseek-r1",
    icon: '/bedrock_icon.png',
    displayName: "Deepseek-r1",
    description: "Deepseek-r1モデルとチャット",
    category: {
      type: "model",
      modelType: "bedrock",
      modelId: "us.deepseek.r1-v1:0",
      region: "us-west-2",
      maxTokens: 2040,
      cost: { input: 0.0, output: 0.0 }
    },
    isImageUploadMenu: false
  },
  {
    value: "my-gpt",
    icon: '/azureOpenai_icon.png',
    displayName: "マイGPT",
    description: "カスタムGPTから回答",
    category: {
      type: "agent"
    },
    isImageUploadMenu: false,
    isAssistantsMenu: true,
    instruction: `
      1. マイGPTの名前を入力します（例：PDF検索くん）。
      2. カスタム指示を入力します（例：アップロードしたファイルの内容に基づいて回答してください）。
      3. 使用するツールを選択します。Code InterpreterやFile Searchを選択した場合、必要に応じてファイルをアップロードできます。
      4. 「作成」ボタンをクリックしてマイGPTを生成し、チャットを開始します。`
  },
  {
    value: "assistants-api",
    icon: '/azureOpenai_icon.png',
    displayName: "Code Interpreter",
    description: "データ分析（GPT-4o）",
    category: {
      type: "agent",
      toolType: "code_interpreter"
    },
    isImageUploadMenu: false,
    isAssistantsMenu: true,
    instruction: `
      1. テキスト入力エリア左のアップロードボタンをクリックします。
      2. 分析対象のファイルを選択してアップロードします。
      3. プロンプトを入力し、送信します。`
  },
  {
    value: "file-search",
    icon: '/azureOpenai_icon.png',
    displayName: "File Search",
    description: "ファイルから回答（GPT-4o）",
    category: {
      type: "agent"
    },
    isImageUploadMenu: false,
    isAssistantsMenu: true,
    instruction: `
      1. テキスト入力エリア左のアップロードボタンをクリックします。
      2. 検索対象のファイルを選択してアップロードします。
      3. プロンプトを入力し、送信します。`
  },
  {
    value: "artifacts",
    icon: '/bedrock_icon.png',
    displayName: "Artifacts",
    description: "SPAを作成（Claude 3.5 Sonnet）",
    category: {
      type: "agent"
    },
    isImageUploadMenu: true
  },
  {
    value: "model-comparison",
    icon: '/kc_icon.png',
    displayName: "モデル比較（チャット）",
    description: "6種類までのLLMを同時に比較",
    category: {
      type: "agent"
    },
    isImageUploadMenu: false
  },
  {
    value: "model-comparison-image",
    icon: '/kc_icon.png',
    displayName: "モデル比較（画像）",
    description: "2種類のLLMで同時に比較",
    category: {
      type: "agent"
    },
    isImageUploadMenu: true,
    instruction: `
      1. テキスト入力エリア左のアップロードボタンをクリックします。
      2. 説明したい画像を選択してアップロードします。
      3. プロンプトを入力し、送信します。`
  }
];

export interface Workspace {
  workspaceId?: string;
  billingMethod?: 'voucher' | 'usage-based';
  limitCost?: number;
  specialMenus?: Menu[];
  owners?: string[];
  admins?: string[];
  users?: string[];
  id?: string;
}

export interface Group {
  groupId: string;
  name: string;
  workspaceId: string;
  members: string[];
  limitMenus: string[];
  limitCost: number;
  id?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
}

export interface WorkspaceInfo {
  workspaceId: string;
  role: string;
}

export interface Cost {
  sessionId: string;
  workspaceId: string;
  groupId?: string;
  userEmail?: string;
  billingMethod?: 'voucher' | 'usage-based';
  billingAmount?: number;
  menu?: string;
  model?: string;
  vectorStoreId?: string;
  inputTokens?: number;
  outputTokens?: number;
  inputCost?: number;
  outputCost?: number;
  createdAt?: string;
  _ts?: number;
}

export interface ResponseDetails {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

// 基本的なChatMessageインターフェース
export interface BaseChatMessage {
  menu: string;
  systemMessage?: string;
  temperature?: number;
  message: string;
  response: string;
  messageTimestamp: string;
  responseTimestamp: string;
  responseDuration?: number;
  responseDetails?: ResponseDetails;
  uploadedFileName?: string;
  fileBase64?: string;
  mediaType?: string;
  responseFiles?: {
    id: string;
    name: string;
  }[];
  [key: string]: any;
}

// MyGPT用のインターフェース
export interface MyGptChatMessage extends BaseChatMessage {
  assistantId?: string;
  threadId?: string;
  toolType?: string;
}

export interface AssistantData {
  assistant_id?: string;
  instructions?: string;
  name?: string;
  tools?: { type: string }[];
  model?: string;
  file?: {
    name: string;
    content: string;
  };
  tool_resources?: {
    file_search?: {
      vector_stores?: {
        file_ids: string[];
      }[];
      vector_store_ids?: string[];
    };
  } | {
    [key: string]: {
      file_ids: string[];
    };
  };
}

export interface FileCounts {
  in_progress: number;
  completed: number;
  cancelled: number;
  failed: number;
  total: number;
}

export interface VectorStore {
  id: string;
  object: string;
  created_at: number;
  usage_bytes: number;
  last_active_at: number;
  name: string;
  status: string;
  file_counts: FileCounts;
  metadata: Record<string, any>;
  last_used_at: number;
}

// ModelComparison用のインターフェース
export interface ModelComparisonChatMessage extends BaseChatMessage {
  selectedModels?: string[];
  modelResponses?: { [key: string]: BaseChatMessage };
}

// Artifacts用のインターフェース
export interface ArtifactsChatMessage extends BaseChatMessage {
  mediaType?: string;
}

// すべてのChatMessageタイプを含むユニオンタイプ
export type ChatMessage =
  | MyGptChatMessage
  | ModelComparisonChatMessage
  | ArtifactsChatMessage

export type MessageSendOptions = {
  message?: string;
  file?: File;
  fileBase64?: string;
  mediaType?: string;
  regenerateIndex?: number;
  regenerateModel?: string;
};

// 添付ファイルの型定義
export interface Attachment {
  fileName: string;
  mediaType: string;
  fileBase64: string;
}

// Updated Message interface incorporating ChatMessage properties
export interface Message {
  role: string;
  content: string;
  timestamp?: string;
  attachments?: Attachment[];
  temperature?: number;
  responseDetails?: ResponseDetails;
  responseFiles?: {
    id: string;
    name: string;
  }[];
  assistantId?: string;
  threadId?: string;
  toolType?: string;
  selectedModels?: string[];
  modelResponses?: { [key: string]: Message };
}

// Updated Session interface
export interface Session {
  sessionId: string;
  groupId: string;
  userEmail: string;
  menu: string;
  temperature?: number;
  messages: Message[];
  assistantData?: AssistantData;
  _ts?: number;
}