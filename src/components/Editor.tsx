import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import { Sparkles, Send, Square } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { streamOllama } from '../services/ollama';
import type { TaskItem } from '../services/ollama';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

export function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

interface EditorProps {
  tabId: string;
  initialContent: string;
  onUpdate: (content: string) => void;
  selectedModel: string;
  onAiThinking: (thinking: boolean) => void;
  onError: (error: string | null) => void;
}

export default function Editor({ tabId, initialContent, onUpdate, selectedModel, onAiThinking, onError }: EditorProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatPosition, setChatPosition] = useState({ top: 0, left: 0 });
  const [hasContent, setHasContent] = useState(false);
  
  const chatInputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({}),
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class: 'prose prose-lg prose-slate focus:outline-none max-w-none min-h-[50vh]',
      },
    },
    onUpdate: ({ editor }) => {
      setHasContent(!editor.isEmpty);
      onUpdate(editor.getHTML());
    }
  });

  useEffect(() => {
    if (editor) {
      setHasContent(!editor.isEmpty);
    }
  }, [editor]);

  useEffect(() => {
    if (showChat && chatInputRef.current) {
      chatInputRef.current.focus();
    }
  }, [showChat]);

  useEffect(() => {
    const handleAgentTask = async (e: Event) => {
      const customEvent = e as CustomEvent<{ task: TaskItem, tabId: string }>;
      const { task, tabId: eventTabId } = customEvent.detail;
      
      if (eventTabId !== tabId || !editor || isGenerating) return;

      setIsGenerating(true);
      onAiThinking(true);
      onError(null);
      editor.setEditable(false);

      const systemPrompt = `You are executing Step: "${task.task}". The context is the file content. Modify or append to it as necessary to fulfill the step. Provide ONLY the final, correct content snippet in Markdown format. Do not add introductory conversational text.`;

      editor.commands.focus('end');
      const startPos = editor.state.selection.from;
      let fullMarkdown = '';

      abortControllerRef.current = new AbortController();

      await streamOllama(
        selectedModel,
        systemPrompt,
        (chunk: string) => {
          if (!editor.isDestroyed) {
             fullMarkdown += chunk;
             const html = DOMPurify.sanitize(marked.parse(fullMarkdown) as string);
             
             editor.commands.deleteRange({ from: startPos, to: editor.state.doc.content.size });
             editor.commands.insertContentAt(startPos, html);
             
             const element = document.querySelector('.ProseMirror');
             if (element) {
                const isScrollable = document.documentElement.scrollHeight > document.documentElement.clientHeight;
                if (isScrollable) {
                  window.scrollTo({
                    top: document.documentElement.scrollHeight,
                    behavior: 'smooth',
                  });
                }
             }
          }
        },
        () => {
          setIsGenerating(false);
          onAiThinking(false);
          editor.setEditable(true);
          onUpdate(editor.getHTML());
          if ((window as any)._markTaskCompleted) {
             (window as any)._markTaskCompleted(task.id);
          }
        },
        (error: Error) => {
          onError(error.message);
          setIsGenerating(false);
          onAiThinking(false);
          editor.setEditable(true);
          if ((window as any)._markTaskFailed) {
             (window as any)._markTaskFailed(task.id);
          }
        },
        abortControllerRef.current.signal
      );
    };

    window.addEventListener('execute-agent-task', handleAgentTask);
    return () => window.removeEventListener('execute-agent-task', handleAgentTask);
  }, [editor, isGenerating, selectedModel, tabId, onAiThinking, onError, onUpdate]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (chatContainerRef.current && !chatContainerRef.current.contains(event.target as Node)) {
        setShowChat(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleAiSubmit = async (promptOverride?: string) => {
    if (!editor || isGenerating) return;

    const userPrompt = promptOverride || chatInput;
    if (!userPrompt.trim()) return;

    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, ' ');
    const isSelection = selectedText.trim().length > 0;
    
    setShowChat(false);
    setChatInput('');
    onError(null);
    setIsGenerating(true);
    onAiThinking(true);
    editor.setEditable(false);

    let systemPrompt = '';
    let startPos = from;

    if (isSelection) {
      systemPrompt = `User request: "${userPrompt}". Apply this to the following text and provide ONLY the modified text in Markdown format. Text: "${selectedText}"`;
    } else {
      systemPrompt = `Write content based on this request: "${userPrompt}". Provide ONLY the content in Markdown format without conversational filler.`;
      if (!editor.isFocused) {
          editor.commands.focus('end');
          startPos = editor.state.selection.from;
      }
    }

    let fullMarkdown = '';

    abortControllerRef.current = new AbortController();

    await streamOllama(
      selectedModel,
      systemPrompt,
      (chunk: string) => {
        if (!editor.isDestroyed) {
           fullMarkdown += chunk;
           const html = DOMPurify.sanitize(marked.parse(fullMarkdown) as string);
           
           editor.commands.deleteRange({ from: startPos, to: isSelection && fullMarkdown === chunk ? to : editor.state.doc.content.size });
           editor.commands.insertContentAt(startPos, html);
           
           const element = document.querySelector('.ProseMirror');
           if (element) {
              const isScrollable = document.documentElement.scrollHeight > document.documentElement.clientHeight;
              if (isScrollable) {
                window.scrollTo({
                  top: document.documentElement.scrollHeight,
                  behavior: 'smooth',
                });
              }
           }
        }
      },
      () => {
        setIsGenerating(false);
        onAiThinking(false);
        editor.setEditable(true);
        onUpdate(editor.getHTML());
      },
      (error: Error) => {
        onError(error.message);
        setIsGenerating(false);
        onAiThinking(false);
        editor.setEditable(true);
      },
      abortControllerRef.current.signal
    );
  };

  const handleBubbleMenuClick = () => {
    if (!editor) return;
    const { view } = editor;
    const { state } = view;
    const { from, to } = state.selection;
    const start = view.coordsAtPos(from);
    const end = view.coordsAtPos(to);
    
    setChatPosition({
      top: Math.max(start.bottom, end.bottom) + window.scrollY + 10,
      left: start.left + window.scrollX
    });
    
    setShowChat(true);
  };

  const starterPrompts = [
    { title: "Write an essay", prompt: "Write a 5 paragraph essay about the impact of artificial intelligence on modern society." },
    { title: "Write code", prompt: "Write a React functional component that displays a digital clock and updates every second." },
    { title: "Brainstorm ideas", prompt: "Give me 10 creative ideas for a new startup in the renewable energy sector." },
    { title: "Draft an email", prompt: "Draft a professional email to a client apologizing for a delay in delivering the project." }
  ];

  if (!editor) {
    return null;
  }

  return (
    <div className="relative w-full flex flex-col h-full z-0">
      {editor && (
        <BubbleMenu 
          editor={editor} 
          shouldShow={({ editor }: any) => {
            return !editor.state.selection.empty && !isGenerating && !showChat;
          }}
        >
          <div className="flex overflow-hidden items-center bg-white shadow-xl border border-gray-200 rounded-lg p-1 space-x-1">
            <button
              onClick={handleBubbleMenuClick}
              disabled={isGenerating}
              className={cn(
                "flex items-center space-x-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                "hover:bg-indigo-50 hover:text-indigo-600 text-gray-700",
                isGenerating && "opacity-50 cursor-not-allowed"
              )}
            >
              <Sparkles className="w-4 h-4 text-indigo-500" />
              <span>Ask AI to edit</span>
            </button>
          </div>
        </BubbleMenu>
      )}

      {showChat && (
        <div 
          ref={chatContainerRef}
          className="absolute z-50 bg-white shadow-2xl border border-gray-200 rounded-xl p-2 w-96 flex items-center"
          style={{ top: chatPosition.top, left: chatPosition.left, position: 'absolute' }}
        >
           <Sparkles className="w-5 h-5 text-indigo-500 ml-2 mr-3" />
           <input 
              ref={chatInputRef}
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAiSubmit();
                }
                if (e.key === 'Escape') {
                   setShowChat(false);
                }
              }}
              placeholder="Tell AI what to do..."
              className="flex-1 outline-none text-sm text-gray-700 py-2 bg-transparent"
           />
           {isGenerating ? (
             <button 
               onClick={(e) => { e.preventDefault(); handleStopGeneration(); }}
               className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
             >
               <Square className="w-4 h-4" />
             </button>
           ) : (
             <button 
               onClick={() => handleAiSubmit()}
               disabled={!chatInput.trim()}
               className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg disabled:opacity-50"
             >
               <Send className="w-4 h-4" />
             </button>
           )}
        </div>
      )}

      {!hasContent && !isGenerating && (
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl text-center z-10 pointer-events-auto">
          <h2 className="text-3xl font-semibold text-slate-800 mb-8">What do you want to create?</h2>
          <div className="grid grid-cols-2 gap-4">
            {starterPrompts.map((item, i) => (
              <button
                key={i}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleAiSubmit(item.prompt); }}
                className="text-left p-4 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 transition-all bg-white shadow-sm cursor-pointer z-20"
              >
                <div className="font-medium text-slate-800 mb-1 flex items-center">
                  <Sparkles className="w-4 h-4 text-indigo-500 mr-2" />
                  {item.title}
                </div>
                <div className="text-sm text-slate-500 line-clamp-2">{item.prompt}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 w-full max-w-3xl mx-auto pb-32">
        <EditorContent editor={editor} />
      </div>

      <div className="fixed bottom-0 left-0 sm:left-64 right-0 p-4 bg-gradient-to-t from-white via-white to-transparent z-40 pointer-events-none">
         <div className="max-w-3xl mx-auto flex gap-2 pointer-events-auto">
            <div className="flex-1 flex items-center bg-white shadow-lg border border-gray-200 rounded-full p-2 pl-4">
               <input
                 type="text"
                 value={chatInput}
                 onChange={(e) => setChatInput(e.target.value)}
                 onKeyDown={(e) => {
                   if (e.key === 'Enter') {
                     e.preventDefault();
                     handleAiSubmit();
                   }
                 }}
                 placeholder="Ask AI to write something..."
                 className="flex-1 outline-none text-gray-700 bg-transparent"
               />
               {isGenerating ? (
                 <button 
                   onClick={(e) => { e.preventDefault(); handleStopGeneration(); }}
                   className="p-3 bg-red-500 text-white hover:bg-red-600 rounded-full transition-colors"
                 >
                   <Square className="w-5 h-5" />
                 </button>
               ) : (
                 <button 
                   onClick={() => handleAiSubmit()}
                   disabled={!chatInput.trim()}
                   className="p-3 bg-indigo-600 text-white hover:bg-indigo-700 rounded-full disabled:opacity-50 transition-colors"
                 >
                   <Send className="w-5 h-5" />
                 </button>
               )}
            </div>
         </div>
      </div>
    </div>
  );
}
