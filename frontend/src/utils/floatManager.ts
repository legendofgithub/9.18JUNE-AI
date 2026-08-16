 import type { FloatWindow } from '../types';
 
 /**
  * FloatManager — 悬浮窗管理工具
  * 处理悬浮窗的布局计算、边界检测、父子关系
  */
 class FloatManager {
   /**
    * 检查并修正悬浮窗位置，确保不超出屏幕
    */
   static clampToScreen(
     position: { x: number; y: number },
     size: { width: number; height: number },
     padding = 16
   ): { x: number; y: number } {
     const maxX = window.innerWidth - size.width - padding;
     const maxY = window.innerHeight - size.height - padding;
 
     return {
       x: Math.max(padding, Math.min(position.x, maxX)),
       y: Math.max(padding, Math.min(position.y, maxY)),
     };
   }
 
   /**
    * 计算新窗口的默认位置（在父窗口右下方偏移）
    */
   static getChildPosition(parentWindow: FloatWindow): { x: number; y: number } {
     return this.clampToScreen(
       {
         x: parentWindow.position.x + 30,
         y: parentWindow.position.y + 40,
       },
       parentWindow.size,
     );
   }
 
   /**
    * 获取层级颜色主题（清新配色）
    */
   static getLevelColors(level: number): {
     border: string;
     header: string;
     badge: string;
   } {
     const themes = [
       { border: '#5b6ef5', header: '#f0f1fe', badge: 'bg-blue-500' },
       { border: '#a855f7', header: '#faf5ff', badge: 'bg-purple-500' },
       { border: '#f97316', header: '#fff7ed', badge: 'bg-orange-500' },
       { border: '#22c55e', header: '#f0fdf4', badge: 'bg-green-500' },
     ];
     return themes[Math.min(level - 1, themes.length - 1)];
   }
 
   /**
    * 获取层级标签文本
    */
   static getLevelLabel(level: number): string {
     return `L${level}`;
   }
 
   /**
    * 检查窗口是否在屏幕可视区域内
    */
   static isOnScreen(position: { x: number; y: number }, size: { width: number; height: number }): boolean {
     return (
       position.x + size.width > 0 &&
       position.y + size.height > 0 &&
       position.x < window.innerWidth &&
       position.y < window.innerHeight
     );
   }
 
   /**
    * 获取所有子窗口 ID
    */
   static getChildIds(parentId: string, windows: FloatWindow[]): string[] {
     const children = windows.filter(w => w.parentThreadId === parentId);
     const ids = children.map(c => c.threadId);
     for (const c of children) {
       ids.push(...this.getChildIds(c.threadId, windows));
     }
     return ids;
   }
 
   /**
    * 获取追问链可视化数据
    */
   static getFollowUpChain(
     messageId: string,
     windows: FloatWindow[],
   ): { threadId: string; level: number; summary: string }[] {
     const chain: { threadId: string; level: number; summary: string }[] = [];
 
     for (const win of windows) {
       if (win.source.sourceMessageId === messageId) {
         chain.push({
           threadId: win.threadId,
           level: win.level,
           summary: win.source.selectedText?.slice(0, 30) ?? '追问',
         });
       }
     }
 
     return chain.sort((a, b) => a.level - b.level);
   }
 }
 
 export default FloatManager;
