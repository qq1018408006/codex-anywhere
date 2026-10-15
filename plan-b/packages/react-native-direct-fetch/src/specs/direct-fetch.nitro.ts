import type { HybridObject } from "react-native-nitro-modules";

export interface DirectFetchHeader {
  key: string;
  value: string;
}

export interface DirectFetchFormDataPart {
  name: string;
  value?: string;
  fileUri?: string;
  fileName?: string;
  mimeType?: string;
}

export interface DirectFetchRequest {
  url: string;
  method?: string;
  headersJson?: string;
  bodyString?: string;
  bodyFormData?: DirectFetchFormDataPart[];
  timeoutMs?: number;
}

export interface DirectFetchDownloadRequest {
  url: string;
  fileUri: string;
  method?: string;
  headersJson?: string;
  bodyString?: string;
  timeoutMs?: number;
}

export interface DirectFetchResponse {
  url: string;
  status: number;
  statusText: string;
  headersJson: string;
  bodyString: string;
}

export interface DirectFetchDownloadResponse {
  url: string;
  status: number;
  statusText: string;
  headersJson: string;
  fileUri: string;
  bytesWritten: number;
}

export interface DirectFetchStreamChunk {
  bodyString: string;
}

export interface DirectFetch extends HybridObject<{ ios: "swift"; android: "kotlin" }> {
  fetch(request: DirectFetchRequest): Promise<DirectFetchResponse>;
  download(request: DirectFetchDownloadRequest): Promise<DirectFetchDownloadResponse>;
  stream(
    request: DirectFetchRequest,
    onChunk: (chunk: DirectFetchStreamChunk) => void,
  ): Promise<DirectFetchResponse>;
}
