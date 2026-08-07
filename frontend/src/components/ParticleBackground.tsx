import { useRef, useEffect } from 'react';

interface Star {
  x: number; y: number;
  r: number;
  baseAlpha: number;
  twinkleSpeed: number;
  twinklePhase: number;
  hue: number;           // 色温：210 冷蓝 ~ 40 暖黄
  saturation: number;
}

interface NebulaBlob {
  x: number; y: number;
  rx: number; ry: number;
  angle: number;
  alpha: number;
  hue: number;
}

/** 纯 Canvas 星空背景：三层星场 + 星云光斑 + 微光闪烁，零外部依赖 */
export default function ParticleBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let stars: Star[] = [];
    let nebulae: NebulaBlob[] = [];

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initStars();
      initNebulae();
    };

    /** 生成星云光斑：大面积极淡的椭圆 */
    const initNebulae = () => {
      const w = canvas.width;
      const h = canvas.height;
      nebulae = [];
      const count = Math.max(3, Math.floor((w * h) / 500000));
      for (let i = 0; i < count; i++) {
        nebulae.push({
          x: Math.random() * w,
          y: Math.random() * h,
          rx: 200 + Math.random() * 500,
          ry: 100 + Math.random() * 300,
          angle: Math.random() * Math.PI * 2,
          alpha: 0.008 + Math.random() * 0.03,
          hue: 200 + Math.random() * 40,  // 蓝-青区间
        });
      }
    };

    /** 生成三层恒星 */
    const initStars = () => {
      const area = canvas.width * canvas.height;
      // 三层密度
      const dimCount = Math.floor(area / 4000);   // 暗星 (最多)
      const midCount = Math.floor(area / 15000);  // 中等星
      const brightCount = Math.floor(area / 80000); // 亮星 (最少)
      stars = [];

      const mkStar = (sizeRange: [number, number], alphaRange: [number, number]): Star => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: sizeRange[0] + Math.random() * (sizeRange[1] - sizeRange[0]),
        baseAlpha: alphaRange[0] + Math.random() * (alphaRange[1] - alphaRange[0]),
        twinkleSpeed: 0.3 + Math.random() * 2.5,
        twinklePhase: Math.random() * Math.PI * 2,
        hue: Math.random() < 0.75 ? 210 + Math.random() * 60 : 30 + Math.random() * 40,
        saturation: Math.random() < 0.7 ? 5 + Math.random() * 15 : 20 + Math.random() * 40,
      });

      // 暗星：大量微小星点，冷白为主
      for (let i = 0; i < dimCount; i++) {
        stars.push(mkStar([0.3, 1.0], [0.15, 0.5]));
      }
      // 中等星：稍大事晃
      for (let i = 0; i < midCount; i++) {
        stars.push(mkStar([0.8, 1.8], [0.35, 0.75]));
      }
      // 亮星：带光晕的大星
      for (let i = 0; i < brightCount; i++) {
        stars.push(mkStar([1.2, 2.5], [0.6, 0.95]));
      }
    };

    const drawNebulae = () => {
      for (const n of nebulae) {
        ctx.save();
        ctx.translate(n.x, n.y);
        ctx.rotate(n.angle);
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(n.rx, n.ry));
        const hsla = `hsla(${n.hue}, 30%, 50%, ${n.alpha})`;
        grad.addColorStop(0, hsla);
        grad.addColorStop(0.4, `hsla(${n.hue}, 20%, 40%, ${n.alpha * 0.6})`);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(0, 0, n.rx, n.ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    };

    const drawStars = (time: number) => {
      for (const s of stars) {
        // 闪烁 = 基础透明度 + 正弦波动
        const twinkle = Math.sin(time * s.twinkleSpeed + s.twinklePhase);
        // 将正弦映射为 0~1（保持大部分时间亮）
        const twinkleAlpha = 0.5 + 0.5 * twinkle;
        const alpha = s.baseAlpha * twinkleAlpha;
        if (alpha < 0.02) continue;

        const hsl = `hsla(${s.hue}, ${s.saturation}%, 85%, ${alpha})`;
        const glowHSL = `hsla(${s.hue}, ${s.saturation}%, 75%, ${alpha * 0.3})`;

        // 画星点
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = hsl;
        ctx.fill();

        // 亮星加光晕
        if (s.r > 1.0) {
          const outerGlow = ctx.createRadialGradient(s.x, s.y, s.r * 0.5, s.x, s.y, s.r * 3);
          outerGlow.addColorStop(0, glowHSL);
          outerGlow.addColorStop(1, 'transparent');
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r * 3, 0, Math.PI * 2);
          ctx.fillStyle = outerGlow;
          ctx.fill();
        }

        // 特大星加十字光芒
        if (s.r > 1.8 && twinkleAlpha > 0.75) {
          const flareAlpha = alpha * 0.15 * twinkleAlpha;
          ctx.save();
          ctx.translate(s.x, s.y);
          const flareLen = s.r * 5;
          const grad = ctx.createLinearGradient(0, -flareLen, 0, flareLen);
          grad.addColorStop(0, 'transparent');
          grad.addColorStop(0.48, 'transparent');
          grad.addColorStop(0.5, `hsla(${s.hue}, ${s.saturation}%, 85%, ${flareAlpha})`);
          grad.addColorStop(0.52, 'transparent');
          grad.addColorStop(1, 'transparent');
          ctx.fillStyle = grad;
          ctx.fillRect(-0.5, -flareLen, 1, flareLen * 2);
          // 十字另一轴
          ctx.rotate(Math.PI / 2);
          ctx.fillRect(-0.5, -flareLen, 1, flareLen * 2);
          ctx.restore();
        }
      }
    };

    const draw = (time: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 1. 极暗底色
      ctx.fillStyle = '#04070d';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // 2. 中央微渐变（模拟银河中心感）
      const centerGlow = ctx.createRadialGradient(
        canvas.width * 0.5, canvas.height * 0.45,
        canvas.width * 0.05,
        canvas.width * 0.5, canvas.height * 0.45,
        canvas.width * 0.6,
      );
      centerGlow.addColorStop(0, 'rgba(0, 40, 80, 0.06)');
      centerGlow.addColorStop(0.5, 'rgba(0, 20, 50, 0.03)');
      centerGlow.addColorStop(1, 'transparent');
      ctx.fillStyle = centerGlow;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // 3. 星云光斑
      drawNebulae();

      // 4. 恒星层
      drawStars(time);

      animationId = requestAnimationFrame((t) => draw(t * 0.001));
    };

    resize();
    window.addEventListener('resize', resize);
    animationId = requestAnimationFrame((t) => draw(t * 0.001));

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 0 }}
    />
  );
}
