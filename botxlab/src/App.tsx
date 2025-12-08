import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSlug from 'rehype-slug';
import { 
  Box, Search, Settings, RefreshCw, X, Menu, LayoutGrid, 
  BookOpen, Tag, GitCommit, Users, FolderGit2, Star, Code2, 
  Sparkles, Book, Globe, CircleDot,
  FileWarning, ExternalLink, GitMerge, Shield, Key, User, Info, Check, Calendar, List, Clock,
  ChevronDown // Ajout de l'icône pour le menu déroulant
} from 'lucide-react';

// --- 1. Interfaces (Typage Strict) ---
interface Repo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  stargazers_count: number;
  updated_at: string;
  language: string | null;
  html_url: string;
  default_branch: string;
  homepage: string | null;
  license: { spdx_id: string } | null;
  open_issues_count: number;
  topics: string[];
}

interface Release {
  id: number;
  name: string;
  tag_name: string;
  prerelease: boolean;
  published_at: string;
  html_url: string;
  body: string;
}

interface Commit {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: {
      name: string;
      date: string;
    };
  };
}

interface Collaborator {
  id: number;
  login: string;
  avatar_url: string;
  html_url: string;
  contributions: number;
}

interface TocItem {
  id: string;
  text: string;
  level: number;
}

type ViewState = 'dashboard' | 'project';
type TabState = 'readme' | 'releases' | 'commits' | 'collaborators';

// --- 2. Utils ---
const stringToColor = (str: string | null): string => {
  if (!str) return '#30363d';
  const colors = ['#58a6ff', '#3fb950', '#d29922', '#db6d28', '#f85149', '#a371f7'];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
};

const timeAgo = (dateString: string): string => {
  const date = new Date(dateString);
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
  if (seconds > 31536000) return Math.floor(seconds / 31536000) + "y ago";
  if (seconds > 2592000) return Math.floor(seconds / 2592000) + "mo ago";
  if (seconds > 86400) return Math.floor(seconds / 86400) + "d ago";
  if (seconds > 3600) return Math.floor(seconds / 3600) + "h ago";
  if (seconds > 60) return Math.floor(seconds / 60) + "m ago";
  return "Just now";
};

// --- 3. Sub-Components (Skeletons & UI) ---
const Skeleton = ({ className }: { className?: string }) => <div className={`skeleton ${className || ''}`} />;

const CardSkeleton = () => (
  <div className="glass-panel p-6 rounded-xl border border-github-border/50">
    <div className="flex justify-between items-start mb-4">
      <div className="flex items-center gap-3 w-full">
        <Skeleton className="w-8 h-8 rounded-lg" />
        <Skeleton className="h-5 rounded w-1/3" />
      </div>
    </div>
    <div className="space-y-2 mb-6">
      <Skeleton className="h-3 rounded w-full" />
      <Skeleton className="h-3 rounded w-2/3" />
    </div>
  </div>
);

// --- Modal Component ---
const Modal = ({ isOpen, onClose, children }: { isOpen: boolean; onClose: () => void; children: React.ReactNode }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-[#161b22] border border-github-border rounded-xl shadow-2xl w-full max-w-md p-6 relative overflow-hidden transform transition-all scale-100 animate-slide-up" onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
};

// --- 4. Main Component ---
export default function App() {
  // State
  const [repos, setRepos] = useState<Repo[]>(() => {
    try {
      const saved = localStorage.getItem('botxlab_cache_v6');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  
  const [config, setConfig] = useState({
    token: localStorage.getItem('botxlab_token') || '',
    org: localStorage.getItem('botxlab_org') || 'botxlab'
  });

  const [currentRepo, setCurrentRepo] = useState<Repo | null>(null);
  const [view, setView] = useState<ViewState>('dashboard');
  const [activeTab, setActiveTab] = useState<TabState>('readme');
  const [searchTerm, setSearchTerm] = useState('');
  
  // UI States
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMobileTabMenuOpen, setIsMobileTabMenuOpen] = useState(false); // État pour le menu burger des onglets

  // Loading & Async Data States
  const [reposLoading, setReposLoading] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'success' | 'failed' | 'loading' | 'idle'>('idle');
  const [repoCopied, setRepoCopied] = useState(false);

  // Content Data (Strictly Typed)
  const [readmeContent, setReadmeContent] = useState<string>('');
  const [toc, setToc] = useState<TocItem[]>([]);
  const [releases, setReleases] = useState<Release[]>([]);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [contentError, setContentError] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // --- API Helper ---
  const getHeaders = useCallback(() => {
    const headers: HeadersInit = { 'Accept': 'application/vnd.github.v3+json' };
    if (config.token) headers['Authorization'] = `Bearer ${config.token}`;
    return headers;
  }, [config.token]);

  // --- Fetch Repositories ---
  const fetchRepos = useCallback(async () => {
    setReposLoading(true);
    setSyncStatus('loading');
    try {
      // Try Org first, then User
      let url = `https://api.github.com/orgs/${config.org}/repos?sort=updated&per_page=100&type=all`;
      let res = await fetch(url, { headers: getHeaders() });
      
      if (res.status === 404) {
        url = `https://api.github.com/users/${config.org}/repos?sort=updated&per_page=100&type=all`;
        res = await fetch(url, { headers: getHeaders() });
      }
      
      if (!res.ok) throw new Error(`API Error: ${res.status}`);
      const data = await res.json();
      
      // Sort by update date
      const processed: Repo[] = data.sort((a: Repo, b: Repo) => 
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
      
      setRepos(processed);
      localStorage.setItem('botxlab_cache_v6', JSON.stringify(processed));
      setSyncStatus('success');
    } catch (error) {
      console.error(error);
      setSyncStatus('failed');
    } finally {
      setReposLoading(false);
    }
  }, [config.org, getHeaders]);

  // Initial Fetch
  useEffect(() => {
    if (repos.length === 0) fetchRepos();
  }, [fetchRepos, repos.length]);

  // --- Fetch Project Data ---
  useEffect(() => {
    if (view === 'project' && currentRepo) {
      const loadContent = async () => {
        setContentLoading(true);
        setContentError(null);
        if (activeTab === 'readme') setReadmeContent('');
        
        try {
          const baseUrl = `https://api.github.com/repos/${currentRepo.full_name}`;
          
          if (activeTab === 'readme') {
            const res = await fetch(`${baseUrl}/readme`, {
               headers: { ...getHeaders(), 'Accept': 'application/vnd.github.v3.raw' }
            });
            if (!res.ok) throw new Error("README not found");
            setReadmeContent(await res.text());
          } 
          else if (activeTab === 'releases') {
            const res = await fetch(`${baseUrl}/releases`, { headers: getHeaders() });
            const data: Release[] = await res.json();
            setReleases(data);
            if(data.length === 0) throw new Error("No releases found");
          } 
          else if (activeTab === 'commits') {
            const res = await fetch(`${baseUrl}/commits?per_page=20`, { headers: getHeaders() });
            setCommits(await res.json());
          } 
          else if (activeTab === 'collaborators') {
            const res = await fetch(`${baseUrl}/contributors`, { headers: getHeaders() });
            const data: Collaborator[] = await res.json();
            setCollaborators(data);
            if(data.length === 0) throw new Error("No contributors found");
          }
        } catch (err: any) {
          setContentError(err.message || "Error fetching data");
        } finally {
          setContentLoading(false);
        }
      };
      loadContent();
    }
  }, [view, activeTab, currentRepo, getHeaders]);

  // --- Optimized TOC Generation ---
  useEffect(() => {
    if (activeTab === 'readme' && readmeContent) {
      requestAnimationFrame(() => {
        const headings = document.querySelectorAll('.markdown-body h1, .markdown-body h2, .markdown-body h3');
        const newToc: TocItem[] = Array.from(headings).map((h, i) => ({
          id: h.id || `heading-${i}`,
          text: h.textContent || '',
          level: parseInt(h.tagName.substring(1))
        }));
        setToc(newToc);
      });
    } else {
      setToc([]);
    }
  }, [readmeContent, activeTab]);

  // --- Memoized Computations ---
  const filteredRepos = useMemo(() => 
    repos.filter(r => r.name.toLowerCase().includes(searchTerm.toLowerCase())),
    [repos, searchTerm]
  );

  const stats = useMemo(() => {
    const totalStars = repos.reduce((acc, r) => acc + (r.stargazers_count || 0), 0);
    const languages = repos.map(r => r.language).filter(Boolean) as string[];
    const topLang = languages.sort((a,b) => 
      languages.filter(v => v===a).length - languages.filter(v => v===b).length
    ).pop() || 'None';
    
    return { totalStars, topLang };
  }, [repos]);

  // --- Handlers ---
  const handleOpenProject = (repo: Repo) => {
    setCurrentRepo(repo);
    setView('project');
    setActiveTab('readme');
    setIsSidebarOpen(false);
    setIsMobileTabMenuOpen(false); // Reset menu state
    setSearchTerm('');
  };

  const copyCloneCmd = () => {
    if(!currentRepo) return;
    navigator.clipboard.writeText(`gh repo clone ${currentRepo.full_name}`);
    setRepoCopied(true);
    setTimeout(() => setRepoCopied(false), 2000);
  }

  // --- Render Helpers ---
  const markdownComponents = {
    img: ({node, ...props}: any) => {
      let url = props.src || '';
      if (currentRepo && !url.startsWith('http') && !url.startsWith('data:')) {
        const branch = currentRepo.default_branch || 'master';
        const cleanPath = url.replace(/^\.\//, '');
        url = `https://raw.githubusercontent.com/${currentRepo.full_name}/${branch}/${cleanPath}`;
      }
      return <img {...props} src={url} className="rounded-lg max-w-full my-4 border border-github-border" alt={props.alt || ''} />;
    },
    a: ({node, ...props}: any) => {
      let url = props.href || '';
      if (currentRepo && !url.startsWith('http') && !url.startsWith('#') && !url.startsWith('mailto:')) {
        const branch = currentRepo.default_branch || 'master';
        const cleanPath = url.replace(/^\.\//, '');
        url = `https://github.com/${currentRepo.full_name}/blob/${branch}/${cleanPath}`;
      }
      return <a {...props} href={url} className="text-github-accent hover:underline" target="_blank" rel="noopener noreferrer" />;
    }
  };

  const tabs = [
    { id: 'readme', icon: BookOpen, label: 'README' },
    { id: 'releases', icon: Tag, label: 'Releases' },
    { id: 'commits', icon: GitCommit, label: 'Commits' },
    { id: 'collaborators', icon: Users, label: 'Collaborators' },
  ];

  return (
    <div className="h-screen flex overflow-hidden font-sans text-sm bg-github-bg text-github-text selection:bg-github-accent selection:text-white">
      
      {/* Mobile Overlay */}
      {isSidebarOpen && <div onClick={() => setIsSidebarOpen(false)} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden animate-fade-in" />}

      {/* Sidebar (Main Navigation) */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-72 bg-[#010409]/95 border-r border-github-border flex flex-col transform transition-transform duration-300 md:relative md:translate-x-0 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} shadow-2xl backdrop-blur-md`}>
        <div className="p-5 flex-shrink-0">
          <div className="flex items-center justify-between mb-6">
            <button onClick={() => setView('dashboard')} className="flex items-center gap-3 text-lg font-bold text-white tracking-tight hover:opacity-80 transition-opacity group">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-indigo-600 text-white rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/20 group-hover:shadow-blue-500/40 transition-all duration-300 transform group-active:scale-95">
                <Box className="w-5 h-5" />
              </div>
              <span className="truncate max-w-[150px]">{config.org}</span>
            </button>
            <button onClick={() => setIsSidebarOpen(false)} className="md:hidden text-github-muted hover:text-white p-1"><X className="w-5 h-5" /></button>
          </div>

          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-github-muted group-focus-within:text-github-accent transition-colors" />
            <input 
              ref={searchInputRef}
              type="text" 
              placeholder="Search..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[#0d1117] border border-github-border rounded-lg py-2 pl-10 pr-12 text-sm text-white placeholder-github-muted focus:border-github-accent focus:outline-none focus:ring-1 focus:ring-github-accent/50 transition-all shadow-sm"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 custom-scrollbar">
            <div className="flex items-center justify-between mb-3 px-2">
                <h3 className="text-[11px] font-bold text-github-muted uppercase tracking-widest">Repositories</h3>
                <span className="text-[10px] bg-github-border text-github-muted px-2 py-0.5 rounded-full font-mono">{filteredRepos.length}</span>
            </div>
            
            {reposLoading ? (
               <div className="p-4 text-center text-github-muted">Loading...</div>
            ) : (
              <div className="space-y-0.5 pb-4">
                {filteredRepos.length === 0 && (
                    <div className="text-center py-8 text-github-muted italic text-xs animate-fade-in">No repositories found</div>
                )}
                {filteredRepos.map(repo => (
                  <button 
                    key={repo.id}
                    onClick={() => handleOpenProject(repo)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-3 transition-all duration-200 group ${currentRepo?.id === repo.id ? 'bg-github-card border-l-2 border-l-github-accent shadow-lg shadow-black/20 text-white' : 'hover:bg-white/5 border-l-2 border-l-transparent text-github-muted hover:text-github-text hover:translate-x-1'}`}
                  >
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: stringToColor(repo.language) }}></div>
                    <span className="text-sm font-medium truncate">{repo.name}</span>
                  </button>
                ))}
              </div>
            )}
        </div>

        <div className="p-4 border-t border-github-border flex justify-between items-center bg-[#010409]">
           <div className="flex items-center gap-3">
             <button onClick={() => setIsSettingsOpen(true)} className="text-github-muted hover:text-white transition-colors p-1.5 hover:bg-github-border rounded-md active:scale-95" title="Settings"><Settings className="w-4 h-4" /></button>
             <span className="flex items-center gap-2 text-[10px] text-github-muted font-mono uppercase tracking-wide opacity-70">
                <span className={`w-1.5 h-1.5 rounded-full ${syncStatus === 'success' ? 'bg-green-500' : syncStatus === 'loading' ? 'bg-blue-500 animate-pulse' : 'bg-red-500'}`}></span>
                {syncStatus === 'loading' ? 'Sync' : syncStatus === 'success' ? 'Synced' : 'Failed'}
             </span>
           </div>
           <button onClick={() => fetchRepos()} className="text-github-muted hover:text-white transition-colors p-1.5 hover:bg-github-border rounded-md active:scale-95" title="Refresh"><RefreshCw className={`w-3.5 h-3.5 ${reposLoading ? 'animate-spin' : ''}`} /></button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full relative overflow-hidden bg-github-bg w-full">
        {/* Notez le retrait de 'overflow-hidden' sur le header principal pour laisser passer le menu */}
        <header className="h-14 md:h-16 border-b border-github-border bg-[#0d1117]/90 backdrop-blur-md flex items-center justify-between px-3 md:px-6 sticky top-0 z-30 shrink-0 shadow-sm transition-all w-full">
          <div className="flex items-center gap-2 md:gap-4 w-full h-full">
            {/* Bouton Menu Sidebar */}
            <button onClick={() => setIsSidebarOpen(true)} className="md:hidden text-github-muted hover:text-white p-1 active:scale-95 flex-shrink-0"><Menu className="w-5 h-5" /></button>
            
            {/* Bouton Retour Dashboard */}
            {view === 'project' && (
              <button onClick={() => setView('dashboard')} className="hidden p-1.5 md:p-2 hover:bg-github-border rounded-lg text-github-muted hover:text-white transition-colors md:block active:scale-95 flex-shrink-0" title="Back to Dashboard"><LayoutGrid className="w-5 h-5" /></button>
            )}

            {/* Titre et Infos (C'est ICI qu'on garde l'overflow-hidden pour le texte) */}
            <div className="flex flex-colXS justify-center h-full min-w-0 flex-1 overflow-hidden">
               <div className="flex items-center gap-2 animate-fade-in min-w-0">
                 <span className="text-github-muted text-sm font-light hidden lg:inline opacity-60 whitespace-nowrap">{config.org} /</span>
                 <h2 className="text-sm md:text-base font-semibold text-white truncate tracking-tight min-w-0">{view === 'dashboard' ? 'Dashboard' : currentRepo?.name}</h2>
               </div>
               
               {view === 'project' && currentRepo && (
                 <div className="hidden md:flex items-center gap-3 mt-0.5 text-xs text-github-muted overflow-x-auto hide-scrollbar whitespace-nowrap animate-slide-up">
                    {currentRepo.homepage && <a href={currentRepo.homepage} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-2 py-0.5 bg-github-accent/10 text-github-accent rounded border border-github-accent/20 hover:bg-github-accent/20 transition-colors"><Globe className="w-3 h-3" /> Website</a>}
                    <span className="flex items-center gap-1.5 px-2 py-0.5 bg-github-card border border-github-border rounded text-github-text"><Star className="w-3 h-3 text-yellow-500" /> {currentRepo.stargazers_count}</span>
                 </div>
               )}
            </div>

            {/* --- ONGLETS (Desktop) --- */}
            {view === 'project' && (
              <div className="hidden md:flex items-center gap-6 ml-auto h-full min-w-0 overflow-x-autoPk hide-scrollbar pl-2 mask-linear">
                 {tabs.map(tab => (
                   <button 
                     key={tab.id}
                     onClick={() => setActiveTab(tab.id as TabState)}
                     className={`relative h-full flex items-center gap-2 text-sm font-medium px-1 transition-colors hover:text-white ${activeTab === tab.id ? 'text-white' : 'text-github-muted'}`}
                   >
                     <tab.icon className={`w-4 h-4 transition-opacity ${activeTab === tab.id ? 'opacity-100' : 'opacity-70'}`} />
                     <span className="hidden lg:inline">{tab.label}</span>
                     {activeTab === tab.id && <span className="absolute bottom-0 left-0 w-full h-[2px] bg-github-accent shadow-[0_-2px_6px_rgba(88,166,255,0.6)] animate-fade-in"></span>}
                   </button>
                 ))}
              </div>
            )}

            {/* --- ONGLETS (Mobile - Menu Burger Déroulant) --- */}
            {view === 'project' && (
              <div className="md:hidden flex items-center ml-2 relative">
                 <button 
                    onClick={(e) => {
                      e.stopPropagation(); // Empêche la fermeture immédiate
                      setIsMobileTabMenuOpen(!isMobileTabMenuOpen);
                    }}
                    className="flex items-center gap-2 text-xs font-medium bg-github-card border border-github-border px-3 py-1.5 rounded-lg text-white active:bg-github-border transition-colors truncate max-w-[140px] z-30 relative"
                 >
                    <span className="truncate">{tabs.find(t => t.id === activeTab)?.label}</span>
                    <ChevronDown className={`w-3 h-3 transition-transform ${isMobileTabMenuOpen ? 'rotate-180' : ''}`} />
                 </button>

                 {/* Menu Dropdown - CORRECTION Z-INDEX */}
                 {isMobileTabMenuOpen && (
                    <>
                      {/* Overlay invisible pour fermer en cliquant ailleurs */}
                      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]" onClick={() => setIsMobileTabMenuOpen(false)}></div>
                      
                      {/* Le Menu lui-même */}
                      <div className="absolute top-[120%] right-0 w-56 bg-[#161b22] border border-github-border rounded-xl shadow-2xl z-50 overflow-hidden animate-slide-up flex flex-col ring-1 ring-white/10">
                        <div className="py-1">
                          {tabs.map(tab => (
                            <button
                              key={tab.id}
                              onClick={() => {
                                setActiveTab(tab.id as TabState);
                                setIsMobileTabMenuOpen(false);
                              }}
                              className={`w-full flex items-center gap-3 px-4 py-3 text-sm text-left transition-colors ${
                                activeTab === tab.id 
                                  ? 'bg-github-accent/10 text-github-accent border-l-2 border-l-github-accent' 
                                  : 'text-github-muted hover:text-white hover:bg-white/5 border-l-2 border-l-transparent'
                              }`}
                            >
                              <tab.icon className="w-4 h-4" />
                              <span className="font-medium">{tab.label}</span>
                              {activeTab === tab.id && <Check className="w-3.5 h-3.5 ml-auto" />}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                 )}
              </div>
            )}
            
            {view === 'project' && currentRepo && (
               <div className="flex ml-2 md:ml-4 items-center gap-1 md:gap-3 border-l border-github-border pl-2 md:pl-4 h-8 my-auto shrink-0 animate-fade-in">
                  <button onClick={copyCloneCmd} className="text-github-muted hover:text-white transition-colors p-1.5 hover:bg-github-border rounded-md group relative active:scale-95 hidden sm:block">
                    {repoCopied ? <Check className="w-5 h-5 text-green-500 animate-bounce" /> : <Code2 className="w-5 h-5" />}
                  </button>
                  <a href={currentRepo.html_url} target="_blank" rel="noreferrer" className="text-github-muted hover:text-white transition-colors p-1.5 hover:bg-github-border rounded-md active:scale-95"><ExternalLink className="w-5 h-5" /></a>
               </div>
            )}
          </div>
        </header>
        
        <div className="flex-1 overflow-y-auto scroll-smooth p-4 md:p-8 w-full">
           <div className="max-w-7xl mx-auto min-h-full w-full">
             
             {/* DASHBOARD VIEW */}
             {view === 'dashboard' && (
               <div className="animate-slide-up">
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 md:gap-6 mb-8">
                     <div className="glass-panel rounded-xl p-6 relative overflow-hidden group hover:border-blue-500/30 transition-all duration-300">
                        <div className="absolute -right-6 -top-6 w-32 h-32 rounded-full blur-3xl group-hover:bg-opacity-20 bg-blue-500/10"></div>
                        <div className="relative z-10">
                            <div className="flex items-center justify-between mb-2">
                                <p className="text-github-muted text-xs font-bold uppercase tracking-wider">Total Projects</p>
                                <FolderGit2 className="w-4 h-4 opacity-80 text-blue-400" />
                            </div>
                            <div className="text-4xl font-bold text-white tracking-tight">{repos.length}</div>
                        </div>
                     </div>
                     <div className="glass-panel rounded-xl p-6 relative overflow-hidden group hover:border-yellow-500/30 transition-all duration-300">
                        <div className="absolute -right-6 -top-6 w-32 h-32 rounded-full blur-3xl group-hover:bg-opacity-20 bg-yellow-500/10"></div>
                        <div className="relative z-10">
                            <div className="flex items-center justify-between mb-2">
                                <p className="text-github-muted text-xs font-bold uppercase tracking-wider">Total Stars</p>
                                <Star className="w-4 h-4 opacity-80 text-yellow-400" />
                            </div>
                            <div className="text-4xl font-bold text-white tracking-tight">{stats.totalStars}</div>
                        </div>
                     </div>
                     <div className="glass-panel rounded-xl p-6 relative overflow-hidden group hover:border-purple-500/30 transition-all duration-300">
                        <div className="absolute -right-6 -top-6 w-32 h-32 rounded-full blur-3xl group-hover:bg-opacity-20 bg-purple-500/10"></div>
                        <div className="relative z-10">
                            <div className="flex items-center justify-between mb-2">
                                <p className="text-github-muted text-xs font-bold uppercase tracking-wider">Top Language</p>
                                <Code2 className="w-4 h-4 opacity-80 text-purple-400" />
                            </div>
                            <div className="text-4xl font-bold text-white tracking-tight">{stats.topLang}</div>
                        </div>
                     </div>
                  </div>

                  <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2.5 animate-fade-in">
                     <div className="p-1.5 bg-yellow-500/10 rounded-md"><Sparkles className="text-yellow-400 w-4 h-4" /></div>
                     Featured Projects
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-slide-up">
                     {reposLoading ? (
                        [...Array(6)].map((_, i) => <CardSkeleton key={i} />)
                     ) : (
                       repos.slice(0, 6).map(repo => (
                         <div key={repo.id} onClick={() => handleOpenProject(repo)} className="glass-panel p-6 rounded-xl cursor-pointer hover:border-github-accent/50 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-blue-500/10 group flex flex-col h-full">
                            <div className="flex justify-between items-start mb-4">
                               <div className="flex items-center gap-3 w-full min-w-0">
                                  <div className="p-2 bg-white/5 rounded-lg group-hover:bg-github-accent/10 transition-colors border border-white/5 flex-shrink-0">
                                     <Book className="w-5 h-5 text-github-muted group-hover:text-github-accent transition-colors" />
                                  </div>
                                  <span className="text-white font-semibold group-hover:text-github-accent transition-colors text-base truncate flex-1 min-w-0">{repo.name}</span>
                               </div>
                            </div>
                            <p className="text-sm text-github-muted mb-6 line-clamp-2 leading-relaxed opacity-80 flex-1">
                               {repo.description || "No description provided for this repository."}
                            </p>
                            
                            <div className="flex items-center justify-between mt-auto border-t border-white/5 pt-4 text-xs text-github-muted">
                               <div className="flex items-center gap-3">
                                   <div className="flex items-center gap-1.5">
                                     <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: stringToColor(repo.language) }}></span>
                                     <span>{repo.language || 'N/A'}</span>
                                   </div>
                                   <span className="hidden sm:inline">•</span>
                                   <span className="flex items-center gap-1 hidden sm:flex"><Clock className="w-3 h-3" /> {timeAgo(repo.updated_at)}</span>
                               </div>
                               <div className="flex items-center gap-1.5 bg-white/5 px-2 py-1 rounded-md border border-white/5">
                                  <Star className="w-3.5 h-3.5 text-yellow-500" /> {repo.stargazers_count}
                               </div>
                            </div>
                         </div>
                       ))
                     )}
                  </div>
               </div>
             )}

             {/* PROJECT VIEW */}
             {view === 'project' && currentRepo && (
               <div className="animate-slide-up flex flex-col xl:flex-row gap-8 items-start w-full">
                  <div className="flex-1 min-w-0 w-full">
                     {contentLoading ? (
                        <div className="animate-fade-in p-10 text-center text-github-muted">Loading content...</div>
                     ) : contentError ? (
                        <div className="flex flex-col items-center justify-center py-24 text-center border border-dashed border-github-border rounded-xl bg-github-card/50">
                           <FileWarning className="w-14 h-14 text-github-muted mb-4 opacity-50" />
                           <h3 className="text-lg font-medium text-white mb-2">Nothing to show</h3>
                           <p className="text-github-muted max-w-md text-sm">{contentError}</p>
                        </div>
                     ) : (
                       <>
                         {activeTab === 'readme' && (
                           <article className="markdown-body bg-transparent animate-fade-in overflow-hidden w-full" id="readme-container">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                rehypePlugins={[rehypeRaw, rehypeSlug]}
                                components={markdownComponents}
                              >
                                {readmeContent}
                              </ReactMarkdown>
                           </article>
                         )}

                         {activeTab === 'releases' && (
                           <div className="space-y-6 animate-slide-up">
                              {releases.map((release) => (
                                <div key={release.id} className="glass-panel p-4 md:p-6 rounded-xl border border-github-border transition-transform hover:scale-[1.005]">
                                   <div className="flex flex-col md:flex-row justify-between items-start mb-4 gap-4">
                                      <div className="min-w-0 flex-1">
                                         <h3 className="text-lg md:text-xl font-bold text-white mb-2 flex items-center gap-3 flex-wrap">
                                            <span className="break-all">{release.name || release.tag_name}</span>
                                            {release.prerelease ? 
                                               <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 font-mono flex-shrink-0">Pre-release</span> :
                                               <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20 font-mono flex-shrink-0">Latest</span>
                                            }
                                         </h3>
                                         <div className="flex flex-wrap items-center gap-3 text-xs text-github-muted">
                                            <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {new Date(release.published_at).toLocaleDateString()}</span>
                                            <span className="font-mono bg-white/5 px-1.5 py-0.5 rounded border border-white/5">{release.tag_name}</span>
                                         </div>
                                      </div>
                                      <a href={release.html_url} target="_blank" rel="noreferrer" className="px-4 py-2 text-xs font-medium bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors text-white flex-shrink-0 active:scale-95 w-full md:w-auto text-center">View on GitHub</a>
                                   </div>
                                   <div className="markdown-body text-sm text-github-text/90 mt-4 border-t border-white/5 pt-4 overflow-hidden">
                                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{release.body}</ReactMarkdown>
                                   </div>
                                </div>
                              ))}
                           </div>
                         )}

                         {activeTab === 'commits' && (
                           <div className="glass-panel rounded-xl border border-github-border overflow-hidden animate-slide-up">
                              {commits.map((item, idx) => (
                                <div key={item.sha} className={`p-4 flex flex-col sm:flex-row gap-4 group hover:bg-white/5 transition-colors ${idx !== commits.length - 1 ? 'border-b border-github-border' : ''}`}>
                                   <div className="flex items-start gap-3 flex-1 min-w-0">
                                      <div className="mt-1 shrink-0"><GitCommit className="w-4 h-4 text-github-muted group-hover:text-github-accent transition-colors" /></div>
                                      <div className="min-w-0">
                                         <p className="text-sm text-white font-mono break-words hover:text-github-accent cursor-pointer transition-colors" title={item.commit.message}>{item.commit.message.split('\n')[0]}</p>
                                         <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-github-muted">
                                            <span className="font-bold text-github-text">{item.commit.author.name}</span>
                                            <span className="opacity-50 hidden sm:inline">•</span>
                                            <span>{timeAgo(item.commit.author.date)}</span>
                                         </div>
                                      </div>
                                   </div>
                                   <div className="flex items-center justify-between sm:justify-end sm:flex-col sm:items-end gap-2 shrink-0">
                                      <a href={item.html_url} target="_blank" rel="noreferrer" className="text-[10px] font-mono text-github-muted hover:text-white bg-white/5 px-2 py-1 rounded border border-white/5 transition-colors hover:border-github-accent/50">{item.sha.substring(0,7)}</a>
                                   </div>
                                </div>
                              ))}
                           </div>
                         )}

                         {activeTab === 'collaborators' && (
                           <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-slide-up">
                              {collaborators.map((user) => (
                                <div key={user.id} className="glass-panel p-4 rounded-xl border border-github-border flex items-center gap-4 hover:border-github-accent/50 transition-all hover:-translate-y-0.5 hover:shadow-lg group min-w-0">
                                   <div className="relative shrink-0">
                                      <img src={user.avatar_url} alt={user.login} className="w-12 h-12 rounded-full border-2 border-github-border group-hover:border-github-accent/50 transition-colors" />
                                      <div className="absolute -bottom-1 -right-1 bg-[#0d1117] rounded-full p-0.5 border border-[#0d1117]">
                                         <div className="bg-green-500 w-2 h-2 rounded-full"></div>
                                      </div>
                                   </div>
                                   <div className="flex-1 min-w-0">
                                      <a href={user.html_url} target="_blank" rel="noreferrer" className="text-white font-medium hover:text-github-accent truncate block text-sm transition-colors">{user.login}</a>
                                      <div className="text-xs text-github-muted mt-0.5 flex items-center gap-1"><GitMerge className="w-3 h-3" /> {user.contributions} commits</div>
                                   </div>
                                   <a href={user.html_url} target="_blank" rel="noreferrer" className="p-2 text-github-muted hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors shrink-0 active:scale-95"><ExternalLink className="w-4 h-4" /></a>
                                </div>
                              ))}
                           </div>
                         )}
                       </>
                     )}
                  </div>
                  
                  {/* TOC Sidebar (Hidden on mobile) */}
                  {activeTab === 'readme' && !contentError && toc.length > 0 && !contentLoading && (
                    <div className="hidden xl:block w-72 flex-shrink-0 animate-fade-in" style={{ animationDelay: '0.2s' }}>
                       <div className="sticky top-24">
                          <div className="glass-panel rounded-xl p-5 border-l-4 border-l-github-accent/50 shadow-lg">
                            <h4 className="text-xs font-bold text-white mb-4 uppercase tracking-widest flex items-center gap-2">
                               <List className="w-3 h-3 text-github-accent" /> On this page
                            </h4>
                            <nav id="toc-content" className="space-y-0.5 max-h-[70vh] overflow-y-auto pr-2 custom-scrollbar">
                               {toc.map(item => (
                                 <a 
                                   key={item.id} 
                                   href={`#${item.id}`} 
                                   onClick={(e) => {
                                     e.preventDefault();
                                     document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth' });
                                   }}
                                   className={`toc-link toc-h${item.level} block py-1 text-sm text-github-muted hover:text-github-accent transition-colors`}
                                   style={{ paddingLeft: `${(item.level - 1) * 12}px` }}
                                 >
                                   {item.text}
                                 </a>
                               ))}
                            </nav>
                          </div>
                       </div>
                    </div>
                  )}
               </div>
             )}
           </div>
        </div>

        {/* Modal (Paramètres) */}
        <Modal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)}>
         <div className="flex justify-between items-center mb-6 relative z-10">
            <h3 className="text-lg font-bold text-white flex items-center gap-2"><Shield className="w-5 h-5 text-github-accent" /> Configuration</h3>
            <button onClick={() => setIsSettingsOpen(false)} className="text-github-muted hover:text-white p-1 rounded hover:bg-white/10 transition-colors active:scale-95"><X className="w-5 h-5" /></button>
         </div>
         <div className="space-y-5 relative z-10">
            <div>
               <label className="block text-sm font-medium text-github-muted mb-2">GitHub User or Organization</label>
               <div className="relative group">
                  <User className="absolute left-3 top-2.5 w-4 h-4 text-github-muted group-focus-within:text-github-accent transition-colors" />
                  <input type="text" value={config.org} onChange={e => setConfig({...config, org: e.target.value})} className="w-full bg-[#0d1117] border border-github-border rounded-lg py-2 pl-10 pr-3 text-white focus:border-github-accent focus:outline-none focus:ring-1 focus:ring-github-accent/50 transition-all text-sm font-mono shadow-inner" />
               </div>
            </div>
            <div>
               <label className="block text-sm font-medium text-github-muted mb-2">Personal Access Token</label>
               <div className="relative group">
                  <Key className="absolute left-3 top-2.5 w-4 h-4 text-github-muted group-focus-within:text-github-accent transition-colors" />
                  <input type="password" value={config.token} onChange={e => setConfig({...config, token: e.target.value})} className="w-full bg-[#0d1117] border border-github-border rounded-lg py-2 pl-10 pr-3 text-white focus:border-github-accent focus:outline-none focus:ring-1 focus:ring-github-accent/50 transition-all text-sm font-mono shadow-inner" />
               </div>
            </div>
            <div className="bg-blue-900/10 border border-blue-500/20 p-4 rounded-lg text-xs text-blue-200 leading-relaxed flex gap-3">
               <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
               <div><strong>Why is this needed?</strong> Without a token, GitHub limits you to 60 requests/hour. Adding a token increases this limit to 5000/hour.</div>
            </div>
         </div>
         <div className="mt-8 flex justify-end gap-3 relative z-10">
            <button onClick={() => setIsSettingsOpen(false)} className="text-sm font-medium text-github-muted hover:text-white px-4 py-2 transition-colors rounded-lg hover:bg-white/5 active:scale-95">Cancel</button>
            <button onClick={() => {
               localStorage.setItem('botxlab_token', config.token);
               localStorage.setItem('botxlab_org', config.org);
               setIsSettingsOpen(false);
               setRepos([]); 
            }} className="bg-github-accent hover:bg-blue-500 text-white px-5 py-2 rounded-lg font-medium text-sm transition-all shadow-lg shadow-blue-500/20 active:scale-95 active:transform">Save Changes</button>
         </div>
        </Modal>
      </main>
    </div>
  );
}