export interface OllamaRequest {
  model: string;
  prompt: string;
  stream?: boolean;
  format?: string;
}

export interface OllamaResponseChunk {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  done_reason?: string;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface OllamaModel {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
}

export interface OllamaTagsResponse {
  models: OllamaModel[];
}

export interface TaskItem {
  id: string;
  task: string;
  targetFile?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export async function fetchModels(): Promise<string[]> {
  try {
    const response = await fetch('http://localhost:11434/api/tags');
    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status}`);
    }
    const data: OllamaTagsResponse = await response.json();
    return data.models.map((m) => m.name);
  } catch (error) {
    console.error("Error fetching Ollama models:", error);
    return [];
  }
}

export async function streamOllama(
  model: string,
  prompt: string,
  onChunk: (chunk: string) => void,
  onComplete: () => void,
  onError: (error: Error) => void,
  signal?: AbortSignal
): Promise<void> {
  const requestBody: OllamaRequest = {
    model,
    prompt,
    stream: true,
  };

  try {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Failed to connect to Ollama. HTTP Status: ${response.status}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      
      if (done) {
        break;
      }

      if (value) {
        const text = decoder.decode(value, { stream: true });
        buffer += text;

        const lines = buffer.split('\n');
        
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() === '') continue;

          try {
            const parsedChunk: OllamaResponseChunk = JSON.parse(line);
            onChunk(parsedChunk.response);
          } catch (e) {
            console.error('Failed to parse JSON chunk:', line, e);
          }
        }
      }
    }

    onComplete();
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.log('Stream aborted by user');
      onComplete();
      return;
    }

    if (err instanceof Error) {
      if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
         onError(new Error('Cannot connect to local Ollama on port 11434. Make sure Ollama is running.'));
      } else {
         onError(err);
      }
    } else {
      onError(new Error('An unknown error occurred while communicating with Ollama.'));
    }
  }
}

export async function generatePlan(
  model: string,
  goal: string,
  context: string = ""
): Promise<TaskItem[]> {
  const prompt = `
You are an expert technical project manager and software architect.
Your job is to break down the following goal into a precise, step-by-step actionable plan.

Context: 
${context || 'None'}

Goal:
${goal}

CRITICAL INSTRUCTIONS:
1. You MUST respond ONLY with a numbered list of tasks.
2. Do NOT output JSON. Do NOT output any introductory or concluding conversational text.
3. Keep each step brief and clear. Limit to a maximum of 6 steps.

Example output:
1. Create authentication context wrapper.
2. Implement login form component.
3. Add form validation logic.
`;

  const requestBody: OllamaRequest = {
    model,
    prompt,
    stream: false,
  };

  try {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const data: OllamaResponseChunk = await response.json();
    const rawText = data.response.trim();
    
    const tasks: TaskItem[] = [];
    const lines = rawText.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      const match = trimmedLine.match(/^(\d+[\.\)]|\*|-)\s+(.*)/);
      if (match && match[2].trim()) {
        tasks.push({
          id: Math.random().toString(36).substr(2, 9),
          task: match[2].trim(),
          status: 'pending'
        });
      }
    }

    if (tasks.length === 0) {
      if (rawText.length > 0) {
        tasks.push({
          id: Math.random().toString(36).substr(2, 9),
          task: rawText,
          status: 'pending'
        });
      } else {
         throw new Error("Model generated an empty plan.");
      }
    }

    return tasks;
  } catch (err) {
    console.error("Failed to generate plan:", err);
    throw err;
  }
}
