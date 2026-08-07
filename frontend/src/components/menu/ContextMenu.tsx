import { useEffect, useRef } from 'react';
import useJuneStore from '../../stores/useJuneStore';

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
      className="fixed bg-[#111827] rounded-xl shadow-2xl border border-[#1e2d3d] py-1 z-[9999] animate-in"
      style={{ left: x, top: y, minWidth: menuWidth }}
    >
      {contextMenu.items.map((item, i) => (
        <button
          key={i}
          onClick={() => {
            item.action();
            hideContextMenu();
          }}
          disabled={item.disabled}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors text-left ${
            item.disabled
              ? 'text-[#3d4d5d] cursor-not-allowed'
              : item.danger
                ? 'text-red-400 hover:bg-red-500/10'
                : 'text-[#c8d6e5] hover:bg-[#1a2332]'
          }`}
        >
          <span className="text-base">{item.icon}</span>
          <span className="flex-1">{item.label}</span>
          {item.shortcut && (
            <span className="text-xs text-[#3d4d5d]">{item.shortcut}</span>
          )}
        </button>
      ))}
    </div>
  );
}
