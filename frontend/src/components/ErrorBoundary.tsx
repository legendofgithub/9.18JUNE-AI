 import React, { Component, type ReactNode } from 'react';
 
 interface ErrorBoundaryProps {
   children: ReactNode;
   /** 边界标识，用于日志定位 */
   name: string;
   /** 自定义降级 UI，不提供则使用默认 */
   fallback?: ReactNode;
   /** 错误回调 */
   onError?: (error: Error, name: string) => void;
 }
 
 interface ErrorBoundaryState {
   hasError: boolean;
   error: Error | null;
 }
 
 /**
  * ErrorBoundary —— React 错误边界
  *
  * 每个 FloatWindow、ChatPanel、FilePanel 独立包裹。
  * 一个窗口/面板崩溃不会导致整个应用白屏。
  *
  * 用法:
  *   <ErrorBoundary name="float-window-L1">
  *     <FloatWindow ... />
  *   </ErrorBoundary>
  */
 export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
   state: ErrorBoundaryState = { hasError: false, error: null };
 
   static getDerivedStateFromError(error: Error): ErrorBoundaryState {
     return { hasError: true, error };
   }
 
   componentDidCatch(error: Error) {
     this.props.onError?.(error, this.props.name);
     console.error(`[ErrorBoundary:${this.props.name}]`, error);
   }
 
   handleRetry = () => {
     this.setState({ hasError: false, error: null });
   };
 
   render() {
     if (this.state.hasError) {
       if (this.props.fallback) {
         return this.props.fallback;
       }
 
       // 默认降级 UI（浅色风格）
       return (
         <div
           style={{
             padding: '16px',
             border: '1px solid var(--june-border)',
             borderRadius: '12px',
             background: 'var(--june-surface)',
             fontSize: '14px',
             boxShadow: '0 1px 3px rgba(45, 49, 66, 0.06)',
           }}
         >
           <p style={{ margin: '0 0 8px 0', color: 'var(--june-danger)', fontWeight: 500 }}>
             ⚠️ 该窗口出现异常，已自动隔离。
           </p>
           <p style={{ margin: '0 0 12px 0', color: 'var(--june-text-dim)', fontSize: '12px' }}>
             {this.state.error?.message || '未知错误'}
           </p>
           <button
             onClick={this.handleRetry}
             style={{
               padding: '4px 12px',
               border: '1px solid var(--june-border)',
               borderRadius: '8px',
               background: 'var(--june-surface)',
               color: 'var(--june-primary)',
               cursor: 'pointer',
               fontSize: '13px',
             }}
           >
             尝试恢复
           </button>
         </div>
       );
     }
 
     return this.props.children;
   }
 }
