import { useState, useEffect } from 'react';
import Editor from './components/Editor';
import { Loader2, AlertCircle, Plus, X, ListTodo, PlayCircle, CheckCircle2, Save, FolderOpen } from 'lucide-react';
import { fetchModels, generatePlan } from './services/ollama';
import type { TaskItem } from './services/ollama';
import { v4 as uuidv4 } from 'uuid';
import { save, open } from '@tauri-apps/plugin-dialog';
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs';
import TurndownService from 'turndown';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

interface Tab {
  id: string;
  title: string;
  content: string;
}

function App() {
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('qwen3.5:2b');

  const [tabs, setTabs] = useState<Tab[]>([
    { id: uuidv4(), title: 'Untitled 1', content: '' }
  ]);
  const [activeTabId, setActiveTabId] = useState<string>(tabs[0].id);

  const [showPlanner, setShowPlanner] = useState(false);
  const [masterGoal, setMasterGoal] = useState('');
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [isPlanning, setIsPlanning] = useState(false);

  useEffect(() => {
    async function loadModels() {
      const availableModels = await fetchModels();
      setModels(availableModels);
      if (availableModels.length > 0 && !availableModels.includes(selectedModel)) {
         setSelectedModel(availableModels[0]);
      }
    }
    loadModels();
  }, []);

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];

  const handleUpdateTabContent = (id: string, newContent: string) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, content: newContent } : t));
  };

  const handleAddTab = () => {
    const newTab = { id: uuidv4(), title: `Untitled ${tabs.length + 1}`, content: '' };
    setTabs([...tabs, newTab]);
    setActiveTabId(newTab.id);
  };

  const handleOpenFile = async () => {
    try {
      const selectedPath = await open({
        multiple: false,
        filters: [{
          name: 'Text & Code Files',
          extensions: ['md', 'txt', 'c', 'cpp', 'py', 'js', 'ts', 'jsx', 'tsx', 'html', 'css', 'json', 'rs', 'go']
        }]
      });

      if (!selectedPath || typeof selectedPath !== 'string') return;

      const fileContent = await readTextFile(selectedPath);
      const fileName = selectedPath.split(/[/\\]/).pop() || 'Unknown File';
      
      let initialHtml = '';
      
      if (fileName.toLowerCase().endsWith('.md')) {
         initialHtml = DOMPurify.sanitize(marked.parse(fileContent) as string);
      } else {
         const ext = fileName.split('.').pop();
         initialHtml = `<pre><code class="language-${ext}">${DOMPurify.sanitize(fileContent)}</code></pre>`;
      }

      const newTab = { id: uuidv4(), title: fileName, content: initialHtml };
      setTabs([...tabs, newTab]);
      setActiveTabId(newTab.id);

    } catch (err: any) {
      setError(`Failed to open file: ${err.message}`);
    }
  };

  const handleCloseTab = (e: React.MouseEvent, idToClose: string) => {
    e.stopPropagation();
    const newTabs = tabs.filter(t => t.id !== idToClose);
    setTabs(newTabs);
    if (activeTabId === idToClose) {
      setActiveTabId(newTabs[newTabs.length - 1].id);
    }
  };

  const handleSaveTab = async () => {
    try {
      const filePath = await save({
        filters: [{
          name: 'Markdown',
          extensions: ['md']
        }, {
          name: 'Text',
          extensions: ['txt']
        }]
      });

      if (!filePath) return;

      const turndownService = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced'
      });
      const markdown = turndownService.turndown(activeTab.content);

      await writeTextFile(filePath, markdown);
      
      const fileName = filePath.split(/[/\\]/).pop();
      if (fileName) {
        setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, title: fileName } : t));
      }

    } catch (err: any) {
      setError(`Failed to save file: ${err.message}`);
    }
  };

  const handleGeneratePlan = async () => {
    if (!masterGoal.trim()) return;
    setIsPlanning(true);
    setError(null);
    try {
      const context = activeTab.content ? `File ${activeTab.title}:\n${activeTab.content}` : '';
      const newTasks = await generatePlan(selectedModel, masterGoal, context);
      setTasks(newTasks);
    } catch (err: any) {
      setError(err.message || 'Failed to generate plan. The model might not support JSON mode properly.');
    } finally {
      setIsPlanning(false);
    }
  };

  const handleExecuteTask = (taskId: string) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'in_progress' } : t));
    
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      const event = new CustomEvent('execute-agent-task', { detail: { task, tabId: activeTabId } });
      window.dispatchEvent(event);
    }
  };

  const markTaskCompleted = (taskId: string) => {
     setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'completed' } : t));
  };

  const markTaskFailed = (taskId: string) => {
     setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'failed' } : t));
  };

  useEffect(() => {
    (window as any)._markTaskCompleted = markTaskCompleted;
    (window as any)._markTaskFailed = markTaskFailed;
    return () => {
      delete (window as any)._markTaskCompleted;
      delete (window as any)._markTaskFailed;
    };
  }, [tasks]);

  return (
    <div className="flex h-screen bg-slate-50 text-gray-900 font-sans overflow-hidden">
      <main className="flex-1 flex flex-col min-w-0 bg-slate-100 relative">
        <header className="flex items-center justify-between px-4 py-2 bg-white border-b border-slate-200 shrink-0">
          <div className="flex items-center space-x-1 overflow-x-auto">
            {tabs.map((tab) => (
              <div 
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                className={`flex items-center px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 cursor-pointer transition-colors ${
                  activeTabId === tab.id 
                    ? 'border-indigo-500 text-indigo-700 bg-slate-50' 
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span className="truncate max-w-[120px]">{tab.title}</span>
                {tabs.length > 1 && (
                  <button 
                    onClick={(e) => handleCloseTab(e, tab.id)}
                    className="ml-2 p-0.5 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
            <button 
              onClick={handleAddTab}
              className="p-1.5 ml-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          
          <div className="flex items-center space-x-4 pl-4 border-l border-slate-200 ml-4">
            <button 
              onClick={handleOpenFile}
              className="flex items-center space-x-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors hover:bg-slate-100 text-slate-600 border border-slate-200"
              title="Open file"
            >
              <FolderOpen className="w-4 h-4" />
              <span className="hidden sm:block">Open</span>
            </button>
            <button 
              onClick={handleSaveTab}
              className="flex items-center space-x-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors hover:bg-slate-100 text-slate-600 border border-slate-200"
              title="Save to file"
            >
              <Save className="w-4 h-4" />
              <span className="hidden sm:block">Save</span>
            </button>
            {isAiThinking && (
              <div className="flex items-center text-sm font-medium text-indigo-600 animate-pulse">
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Working...
              </div>
            )}
            
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="text-sm border-slate-200 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 py-1.5 pl-3 pr-8 bg-white"
            >
               {models.length === 0 ? (
                 <option value={selectedModel}>{selectedModel}</option>
               ) : (
                 models.map((model) => (
                   <option key={model} value={model}>{model}</option>
                 ))
               )}
            </select>
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          {showPlanner && (
            <div className="w-80 bg-white border-r border-slate-200 flex flex-col shrink-0 shadow-[4px_0_24px_rgba(0,0,0,0.02)] z-10">
               <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                 <h2 className="font-medium text-slate-800 flex items-center">
                    <ListTodo className="w-4 h-4 mr-2 text-indigo-500" />
                    Agent Plan
                 </h2>
                 <button onClick={() => setShowPlanner(false)} className="text-slate-400 hover:text-slate-600">
                    <X className="w-4 h-4" />
                 </button>
               </div>
               
               <div className="p-4 border-b border-slate-100 flex flex-col gap-3">
                  <textarea 
                    value={masterGoal}
                    onChange={(e) => setMasterGoal(e.target.value)}
                    placeholder="E.g., Build a full authentication flow including Login and Register forms..."
                    className="w-full text-sm border-slate-200 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 min-h-[80px] p-2 resize-none"
                  />
                  <button 
                    onClick={handleGeneratePlan}
                    disabled={isPlanning || !masterGoal.trim()}
                    className="w-full bg-slate-800 text-white py-2 rounded-md text-sm font-medium hover:bg-slate-700 disabled:opacity-50 flex items-center justify-center"
                  >
                    {isPlanning ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    {isPlanning ? 'Generating Plan...' : 'Generate Plan'}
                  </button>
               </div>

               <div className="flex-1 overflow-y-auto p-4 bg-slate-50">
                  {tasks.length === 0 ? (
                     <div className="text-center text-sm text-slate-500 mt-10">
                        No active plan. Define a goal above.
                     </div>
                  ) : (
                     <ul className="space-y-3">
                        {tasks.map((task, index) => (
                          <li key={task.id} className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                             <div className="flex justify-between items-start mb-2">
                               <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">Step {index + 1}</span>
                               {task.status === 'completed' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                               {task.status === 'in_progress' && <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />}
                               {task.status === 'pending' && (
                                  <button 
                                    onClick={() => handleExecuteTask(task.id)}
                                    className="text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 p-1 rounded-md transition-colors"
                                    title="Execute this step"
                                  >
                                     <PlayCircle className="w-4 h-4" />
                                  </button>
                               )}
                               {task.status === 'failed' && <span className="text-xs text-red-500 font-medium">Failed</span>}
                             </div>
                             <p className="text-sm text-slate-700 leading-snug">{task.task}</p>
                             {task.targetFile && (
                                <div className="mt-2 text-xs text-slate-400 font-mono">
                                   target: {task.targetFile}
                                </div>
                             )}
                          </li>
                        ))}
                     </ul>
                  )}
               </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto relative bg-white h-full">
            {error && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 w-full max-w-lg">
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-start shadow-sm">
                  <AlertCircle className="w-5 h-5 mr-3 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="text-sm font-medium">Error</h3>
                    <p className="mt-1 text-sm text-red-600">{error}</p>
                  </div>
                  <button 
                    onClick={() => setError(null)}
                    className="text-red-500 hover:text-red-700"
                  >
                    &times;
                  </button>
                </div>
              </div>
            )}

            <div className="w-full h-full p-4 sm:p-8">
               <Editor 
                  key={activeTabId}
                  tabId={activeTabId}
                  initialContent={activeTab.content}
                  onUpdate={(content) => handleUpdateTabContent(activeTabId, content)}
                  selectedModel={selectedModel}
                  onAiThinking={setIsAiThinking}
                  onError={setError}
               />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
