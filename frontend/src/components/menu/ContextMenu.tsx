 import { useEffect, useRef } from 'react';
 import { Copy, MessageSquareQuote, type LucideIcon } from 'lucide-react';
 import useJuneStore from '../../stores/useJuneStore';
 
 /** 图标字符串键到 lucide 组件的映射 */
 const ICON_MAP: Record<string, LucideIcon> = {
   copy: Copy,
   followup: MessageSquareQuote,
 };
 
 export default function ContextMenu() {
   const contextMenu = useJuneStore(s => s.contextMenu);
   const hideContextMenu = useJuneStore(s => s.hideContextMenu);
   const menuRef = useRef<HTMLDivElement>(null);
 
   useEffect(() => {
     if (!contextMenu) return;
 
     const handleClick = (e: MouseEvent) => {
       if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
         hideContextMenu();
       }
     };
 
     const handleEsc = (e: KeyboardEvent) => {
       if (e.key === 'Escape') hideContextMenu();
     };
 
     // 延迟绑定以避免触发自己的 click
     setTimeout(() => {
       document.addEventListener('click', handleClick);
       document.addEventListener('contextmenu', handleClick);
       document.addEventListener('keydown', handleEsc);
     }, 0);
 
     return () => {
       document.removeEventListener('click', handleClick);
       document.removeEventListener('contextmenu', handleClick);
       document.removeEventListener('keydown', handleEsc);
     };
   }, [contextMenu, hideContextMenu]);
 
   if (!contextMenu) return null;
 
   // 调整位置防止溢出屏幕
   const menuWidth = 180;
   const menuHeight = contextMenu.items.length * 36 + 16;
   let x = contextMenu.x;
   let y = contextMenu.y;
 
   if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 8;
   if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 8;
   if (x < 0) x = 8;
   if (y < 0) y = 8;
 
   return (
     <div
       ref={menuRef}
       className="fixed rounded-xl py-1 z-[9999] animate-fade-in card-shadow-lg"
       style={{ left: x, top: y, minWidth: menuWidth, background: 'var(--june-surface)', border: '1px solid var(--june-border)' }}
     >
       {contextMenu.items.map((item, i) => {
         const Icon = ICON_MAP[item.icon];
         return (
           <button
             key={i}
             onClick={() => {
               item.action();
               hideContextMenu();
             }}
             disabled={item.disabled}
             className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm transition-colors text-left"
             style={{ color: item.disabled ? 'var(--june-text-dim)' : item.danger ? 'var(--june-danger)' : 'var(--june-text)' }}
             onMouseEnter={e => { if (!item.disabled) e.currentTarget.style.background = item.danger ? 'rgba(239,68,68,0.06)' : 'var(--june-primary-light)'; }}
             onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
           >
             {Icon ? <Icon size={15} /> : <span className="text-base w-[15px] text-center">{item.icon}</span>}
             <span className="flex-1">{item.label}</span>
             {item.shortcut && (
               <span className="text-xs" style={{ color: 'var(--june-text-dim)' }}>{item.shortcut}</span>
             )}
           </button>
         );
       })}
     </div>
   );
 }
