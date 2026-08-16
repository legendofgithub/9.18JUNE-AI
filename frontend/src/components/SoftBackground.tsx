 /**
  * SoftBackground — 清新极简风格的装饰性背景
  * 使用纯 CSS 渐变 blob 实现柔和的彩色光斑，不依赖 Canvas。
  * 3-4 个低透明度模糊圆形（蓝、紫、浅粉），极缓慢浮动。
  */
 export default function SoftBackground() {
   return (
     <div
       className="absolute inset-0 pointer-events-none overflow-hidden"
       style={{ zIndex: 0, background: 'var(--june-bg)' }}
     >
       {/* 蓝色光斑 — 左上 */}
       <div
         className="absolute rounded-full animate-float-slow"
         style={{
           top: '-8%',
           left: '-6%',
           width: '420px',
           height: '420px',
           background: 'radial-gradient(circle, rgba(91,110,245,0.14) 0%, transparent 70%)',
           animationDelay: '0s',
         }}
       />
       {/* 紫色光斑 — 右下 */}
       <div
         className="absolute rounded-full animate-float-slow"
         style={{
           bottom: '-10%',
           right: '-8%',
           width: '480px',
           height: '480px',
           background: 'radial-gradient(circle, rgba(168,85,247,0.12) 0%, transparent 70%)',
           animationDelay: '-6s',
         }}
       />
       {/* 浅粉光斑 — 右上 */}
       <div
         className="absolute rounded-full animate-float-slow"
         style={{
           top: '20%',
           right: '15%',
           width: '300px',
           height: '300px',
           background: 'radial-gradient(circle, rgba(244,114,182,0.08) 0%, transparent 70%)',
           animationDelay: '-12s',
         }}
       />
       {/* 蓝紫光斑 — 左下 */}
       <div
         className="absolute rounded-full animate-float-slow"
         style={{
           bottom: '15%',
           left: '10%',
           width: '340px',
           height: '340px',
           background: 'radial-gradient(circle, rgba(59,130,246,0.08) 0%, transparent 70%)',
           animationDelay: '-3s',
         }}
       />
     </div>
   );
 }
