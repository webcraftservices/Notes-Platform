"use client"; // remove this line if you're not using Next.js App Router

import { useEffect, useRef } from "react";

/**
 * LinesGradientShader (v4 – motion traced from the reference video)
 *
 * The ribbon path, thickness and colour-band proportions were measured frame by
 * frame from the reference recording and replayed as one slow, continuous,
 * seamlessly looping sweep: it rises out of the bottom-right, opens into a wide
 * arc across the screen, then glides back. No added wobble, no pulsing.
 *
 * Plain WebGL2, no dependencies. Put it in a `relative` parent, content above.
 */

/** Ribbon motion extracted from the reference video: a seamless, periodic cubic B-spline
 *  through 28 control points. Each row = [top-edge cubic x4, thickness cubic x4, band splits x4]. */
const PERIOD = 55.0; // seconds for one full loop
const CTRL: number[][] = [
  [-0.6228,1.4994,-0.2444,0.1815,0.2874,0.0594,-0.4606,0.3398,0.6424,0.7336,0.8203,0.9099],
  [-0.5323,1.2464,0.2099,-0.0598,0.3748,-0.3787,0.1911,0.0516,0.6241,0.7124,0.802,0.8989],
  [-0.3809,0.7157,1.0292,-0.4465,0.4814,-0.9498,1.0369,-0.3098,0.6002,0.6886,0.7829,0.8874],
  [-0.1869,0.0416,1.9997,-0.889,0.6119,-1.6189,2.0104,-0.716,0.5577,0.6521,0.7555,0.8722],
  [-0.1261,-0.1773,2.523,-1.2208,0.6595,-2.0715,2.9183,-1.1955,0.5146,0.6171,0.7316,0.8609],
  [-0.1011,-0.1885,2.7267,-1.4161,0.6832,-2.3904,3.6661,-1.6262,0.4759,0.5885,0.7142,0.8553],
  [-0.0784,-0.0926,2.6694,-1.4669,0.7139,-2.6339,4.2375,-1.9647,0.44,0.5628,0.6993,0.8511],
  [-0.0757,0.1249,2.3676,-1.3881,0.7369,-2.7663,4.5979,-2.1984,0.4032,0.5345,0.6816,0.843],
  [-0.0651,0.3145,2.0271,-1.2513,0.6813,-2.5481,4.4221,-2.1575,0.377,0.5159,0.6712,0.8406],
  [-0.044,0.4256,1.7536,-1.1202,0.5714,-2.0677,3.8296,-1.9053,0.3541,0.5008,0.6629,0.8386],
  [-0.0217,0.4822,1.5495,-1.0218,0.4772,-1.5816,3.1745,-1.6237,0.325,0.4803,0.6489,0.8296],
  [0.0006,0.5399,1.3183,-0.9065,0.4266,-1.2334,2.681,-1.4197,0.3053,0.4675,0.6416,0.8261],
  [0.0297,0.5354,1.1675,-0.8213,0.4249,-1.1127,2.521,-1.3792,0.2952,0.4613,0.6399,0.8269],
  [0.0656,0.4297,1.1591,-0.7864,0.4563,-1.1874,2.6516,-1.4734,0.287,0.4547,0.6379,0.826],
  [0.0866,0.3603,1.0406,-0.6604,0.4901,-1.2488,2.6622,-1.4648,0.273,0.4442,0.6334,0.8215],
  [0.093,0.3367,0.8984,-0.5399,0.5144,-1.2698,2.6293,-1.4504,0.2699,0.448,0.64,0.8226],
  [0.0884,0.3518,0.77,-0.457,0.5264,-1.2324,2.5414,-1.4335,0.2853,0.4719,0.6609,0.833],
  [0.0682,0.4487,0.4123,-0.1999,0.5233,-1.0203,1.9531,-1.0679,0.2963,0.4892,0.6731,0.8405],
  [0.0355,0.5618,0.0919,0.0225,0.4925,-0.6976,1.2307,-0.6542,0.3141,0.5066,0.6842,0.8471],
  [-0.0013,0.6173,0.0184,0.0631,0.4355,-0.3743,0.7106,-0.4264,0.3436,0.5293,0.6998,0.8551],
  [-0.0321,0.5863,0.1077,0.03,0.377,-0.1393,0.3469,-0.2634,0.3687,0.5479,0.7117,0.8614],
  [-0.0633,0.5396,0.2531,-0.0334,0.3149,0.0266,0.1311,-0.1727,0.3946,0.5675,0.7244,0.868],
  [-0.0979,0.5207,0.388,-0.1012,0.2816,0.0757,0.0717,-0.1463,0.4221,0.5875,0.7369,0.8735],
  [-0.1238,0.4981,0.5258,-0.1699,0.3332,-0.1037,0.1966,-0.1534,0.4412,0.5973,0.7398,0.8727],
  [-0.1598,0.5277,0.6061,-0.2161,0.3802,-0.2829,0.329,-0.1593,0.4624,0.6088,0.7453,0.8742],
  [-0.1402,0.4603,0.7708,-0.3021,0.3827,-0.4018,0.5358,-0.2447,0.4624,0.6065,0.7416,0.8731],
  [-0.28,0.7643,0.4702,-0.1583,0.3412,-0.2363,0.2216,-0.0675,0.5136,0.6433,0.7645,0.8844],
  [-0.5413,1.344,-0.145,0.1371,0.2749,0.095,-0.4194,0.2824,0.6065,0.7109,0.8079,0.9051]
];
const N = CTRL.length;
const P = new Float32Array(12);
function evalRibbon(t: number) {
  const u = (((t % PERIOD) + PERIOD) % PERIOD) / PERIOD * N;
  const i = Math.floor(u), f = u - i;
  const w0 = (1 - f) ** 3 / 6, w1 = (3 * f ** 3 - 6 * f ** 2 + 4) / 6;
  const w2 = (-3 * f ** 3 + 3 * f ** 2 + 3 * f + 1) / 6, w3 = f ** 3 / 6;
  const a = CTRL[(i - 1 + N) % N] as number[], b = CTRL[i % N] as number[], c = CTRL[(i + 1) % N] as number[], d = CTRL[(i + 2) % N] as number[];
  for (let j = 0; j < 12; j++) P[j] = w0 * a[j]! + w1 * b[j]! + w2 * c[j]! + w3 * d[j]!;
  return P;
}

const VERT = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2  u_res;
uniform float u_time;
uniform vec3  u_bg;
uniform float u_p[12];   // [0..3] top-edge cubic, [4..7] thickness cubic, [8..11] band split fractions
out vec4 outColor;

const vec3 C0 = vec3(142.0,  71.0, 239.0) / 255.0;   // violet
const vec3 C1 = vec3(199.0,  46.0, 217.0) / 255.0;   // magenta
const vec3 C2 = vec3(226.0,  46.0, 107.0) / 255.0;   // red
const vec3 C3 = vec3(239.0, 153.0,  34.0) / 255.0;   // orange
const vec3 C4 = vec3(252.0, 242.0, 137.0) / 255.0;   // yellow

float hash11(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float hash21(vec2 p)  { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  float k = clamp(aspect / 2.094, 0.55, 1.5);
  float x = 0.5 + (uv.x - 0.5) * k;
  float y = uv.y;

  // ribbon top edge and thickness, both smooth cubics of x
  float T  = u_p[0] + x * (u_p[1] + x * (u_p[2] + x * u_p[3]));
  float Wd = u_p[4] + x * (u_p[5] + x * (u_p[6] + x * u_p[7]));

  // band boundaries sit at fixed fractions of the thickness at any instant
  float e0 = T;
  float e1 = T - Wd * u_p[8];
  float e2 = T - Wd * u_p[9];
  float e3 = T - Wd * u_p[10];
  float e4 = T - Wd * u_p[11];
  float e5 = T - Wd;

  float aa = 1.25 / u_res.y;
  vec3 col = u_bg;
  col = mix(col, C0, clamp((e0 - y) / aa + 0.5, 0.0, 1.0));
  col = mix(col, C1, clamp((e1 - y) / aa + 0.5, 0.0, 1.0));
  col = mix(col, C2, clamp((e2 - y) / aa + 0.5, 0.0, 1.0));
  col = mix(col, C3, clamp((e3 - y) / aa + 0.5, 0.0, 1.0));
  col = mix(col, C4, clamp((e4 - y) / aa + 0.5, 0.0, 1.0));
  col = mix(u_bg, col, clamp((y - e5) / aa + 0.5, 0.0, 1.0));

  // very faint pinstripes that follow the ribbon (as in the reference)
  float f  = clamp((e0 - y) / max(Wd, 1e-4), 0.0, 1.0);
  float q  = f * 64.0;
  float id = floor(q);
  float fr = fract(q);
  float fw = fwidth(q) * 1.2 + 1e-4;
  float line = (1.0 - smoothstep(0.0, 0.10 + fw, fr)) * step(0.62, hash11(id));
  float inside = clamp((e0 - y) / aa, 0.0, 1.0) * clamp((y - e5) / aa, 0.0, 1.0);
  col = mix(col, vec3(1.0), line * 0.055 * inside);

  col += (hash21(gl_FragCoord.xy + fract(u_time) * 91.0) - 0.5) * 0.012;  // dither, kills banding
  outColor = vec4(col, 1.0);
} `;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
  return s;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

type Props = {
  className?: string;
  /** playback speed. 1 = same pace as the reference (55s loop). 0.5 = twice as slow */
  speed?: number;
  /** start position in seconds. 0 = ribbon just rising from the bottom-right */
  startTime?: number;
  /** background colour (default #0a0a0a) */
  background?: string;
};

export default function LinesGradientShader({
  className = "",
  speed = 1,
  startTime = 0,
  background = "#0a0a0a",
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false });
    if (!gl) return;

    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "u_res");
    const uTime = gl.getUniformLocation(prog, "u_time");
    const uP = gl.getUniformLocation(prog, "u_p");
    gl.uniform3fv(gl.getUniformLocation(prog, "u_bg"), hexToRgb(background));

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let raf = 0;
    let last = performance.now();
    let time = reduceMotion ? PERIOD * 0.42 : startTime; // reduced motion: parked on the wide arc
    const draw = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1); // ignore tab-switch jumps
      last = now;
      if (!reduceMotion) time += dt * speed;
      gl.uniform1fv(uP, evalRibbon(time));
      gl.uniform1f(uTime, time);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!reduceMotion) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      gl.deleteProgram(prog);
      gl.deleteBuffer(buf);
    };
  }, [speed, startTime, background]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  );
}
