"use client"

import { useEffect, useRef, useState } from "react"

/**
 * A FIELD OF LIQUID CHROME — raymarched, live.
 *
 * WHY THIS IS NOT CSS. The band carried a CSS "pool" before this: circles merged by a blur
 * filter into one silhouette. The merging was real and the material was not — a gradient
 * cannot produce a mirror reflection, dark banding or a caustic, and those are the entire
 * substance of chrome. The generated stills had the material and could not move. Detaching
 * and recombining IS the idea here, so it has to be rendered.
 *
 * WHY NO LIBRARY. This is one quad and one fragment shader. three.js is hundreds of kilobytes
 * to draw a rectangle, and the app has no WebGL precedent to match — the canvas work here is
 * all 2D (design-canvas.tsx and friends). Raw WebGL2 keeps the payload at zero.
 *
 * HOW IT DETACHES AND RECOMBINES. Six spheres, combined with a smooth minimum: two that come
 * within the blend radius stop being two surfaces and become one, with the normal — and so the
 * reflection — bending continuously across the join. Nothing is keyframed. The blobs simply
 * drift, and the fusing and splitting is a consequence of where they are, which is the same
 * property the goo filter had and the only thing worth keeping from it.
 *
 * WHY IT NEVER REPEATS. Each ball moves on two clocks whose periods are never a simple ratio
 * of each other, so the field's configuration does not return on a beat. The band's CSS motion
 * already worked this way and the rule carries over unchanged: a visible cycle is what makes
 * ambient motion read as a mechanism.
 *
 * WHAT IT COSTS, AND WHY THAT IS THE RISK. This runs on a header that is open all day on every
 * page. So: half-resolution buffer scaled up by CSS (the field is soft at band size — it
 * quarters the fragment count and nothing is lost), 30fps rather than a draw per frame, and a
 * hard stop when the band is off-screen or the tab is hidden. A header that keeps a GPU warm
 * behind another tab is the version of this that gets deleted in a month.
 */

const BALLS = 6

/**
 * The shader.
 *
 * Ray-sphere marching against a smooth-min field, then one reflection into a procedural
 * environment. The environment is the whole trick: a bright sky, a dark floor and one hot bar
 * across the top. Chrome is not a colour, it is a picture of a room — with a flat environment
 * the same geometry renders as a grey lump, and it is the dark/light banding that says metal.
 */
const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;

uniform vec2 uRes;      // drawing buffer size
uniform float uTime;    // seconds
uniform vec2 uPointer;  // pointer in field space; x = -100.0 when absent
uniform float uPush;    // how hard the pointer pushes

const int BALLS = ${BALLS};

/* Smooth minimum. k is the blend radius: below it two surfaces become one, above it they are
   separate objects. This single line is the detaching and the recombining. */
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

/* Where ball i is at time t. Two clocks per ball, deliberately not in simple ratio — 0.31 and
   0.19 of a second, 0.23 and 0.13, and so on — so the field does not return to a pose. */
/* THE FIELD IS LAID OUT IN THE BAND'S ASPECT, not in a square. The band is about 6:1, and a
   layout written in world units without that knowledge put six balls across the middle fifth
   of the frame — correct, tiny, and marooned in space. Spread is a fraction of the visible
   WIDTH, which the shader gets from uRes. */
vec3 ballPos(int i, float t, float aspect) {
  float f = float(i);
  float ax = 0.31 + 0.041 * f;
  float ay = 0.19 + 0.033 * f;
  float phase = f * 1.7;
  float span = aspect * 0.40;
  return vec3(
    (f / float(BALLS - 1) - 0.5) * 2.0 * span + sin(t * ax + phase) * span * 0.22,
    sin(t * ay + phase * 1.3) * 0.13,
    cos(t * (0.13 + 0.02 * f) + phase) * 0.30
  );
}

float ballRadius(int i) {
  float f = float(i);
  return 0.30 + 0.09 * sin(f * 2.1);
}

/* The field. The pointer term pushes centres away with a squared falloff — near ones hard,
   far ones not at all, which is what repulsion looks like rather than the whole field tilting.
   Vertical push is a fraction of horizontal because the band is 90px tall and an equal shove
   would throw the liquid out of frame. */
float map(vec3 p, float t) {
  float aspect = uRes.x / uRes.y;
  float d = 1e9;
  for (int i = 0; i < BALLS; i++) {
    vec3 c = ballPos(i, t, aspect);
    if (uPointer.x > -50.0) {
      vec2 away = c.xy - uPointer;
      float dist = length(away);
      if (dist < 0.9 && dist > 0.0001) {
        float f = (1.0 - dist / 0.9);
        f = f * f * uPush;
        c.xy += normalize(away) * vec2(f, f * 0.28);
      }
    }
    d = smin(d, length(p - c) - ballRadius(i), 0.34);
  }
  return d;
}

/* TETRAHEDRON NORMALS — four samples, not six. The central-difference version calls the field
   six times per pixel and the field itself loops every ball; on a software renderer that was
   enough to kill the context outright, and on a real GPU it is a third of the frame for no
   visible gain at this size. */
vec3 normalAt(vec3 p, float t) {
  const vec2 k = vec2(1.0, -1.0);
  const float e = 0.0018;
  return normalize(
    k.xyy * map(p + k.xyy * e, t) +
    k.yyx * map(p + k.yyx * e, t) +
    k.yxy * map(p + k.yxy * e, t) +
    k.xxx * map(p + k.xxx * e, t)
  );
}

/* The room the chrome reflects. Sky above, dark floor below, one bright horizontal bar — a
   softbox — plus a faint warm bounce that keeps the metal from reading as plastic. */
vec3 env(vec3 r) {
  float up = r.y * 0.5 + 0.5;
  vec3 sky = mix(vec3(0.06, 0.07, 0.09), vec3(0.92, 0.94, 1.0), smoothstep(0.35, 0.95, up));
  float bar = smoothstep(0.030, 0.0, abs(r.y - 0.34)) * smoothstep(-0.85, 0.35, r.x);
  sky += vec3(1.0) * bar * 1.5;
  float warm = smoothstep(0.25, -0.35, r.y) * smoothstep(0.4, -0.6, r.x);
  sky += vec3(0.30, 0.16, 0.05) * warm;
  return sky;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float t = uTime;

  /* uv is already in units of half-height, so a scale of 1 makes the visible frame exactly
     one world unit tall — the size the balls are written against. The old 2.6 made the world
     two and a half times bigger than the thing in it. */
  vec3 ro = vec3(uv, 2.6);
  vec3 rd = normalize(vec3(uv * 0.13, -1.0));

  float dist = 0.0;
  bool hit = false;
  vec3 p = ro;
  for (int i = 0; i < 48; i++) {
    p = ro + rd * dist;
    float d = map(p, t);
    if (d < 0.0016) { hit = true; break; }
    dist += d;
    if (dist > 5.0) break;
  }

  if (!hit) { outColor = vec4(0.0); return; }

  vec3 n = normalAt(p, t);
  vec3 r = reflect(rd, n);
  vec3 col = env(r);

  /* Fresnel: grazing angles reflect nearly everything, which is what gives a chrome edge its
     bright rim and stops the silhouette dissolving into the dark plate behind it. */
  float fres = pow(1.0 - max(dot(n, -rd), 0.0), 4.0);
  col = mix(col * 0.82, vec3(1.0), fres * 0.5);

  /* One tight specular so the form always carries a highlight even where the environment is
     dark — without it a blob facing the floor goes to mud. */
  vec3 lightDir = normalize(vec3(-0.45, 0.75, 0.6));
  col += vec3(1.0) * pow(max(dot(r, lightDir), 0.0), 90.0) * 0.9;

  /* A hair of edge softness so the silhouette does not alias against the band. */
  float edge = smoothstep(0.0, 0.9, 1.0 - fres * 0.15);
  outColor = vec4(col, edge);
}
`

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`

export function BandChrome() {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  /** Set only when WebGL2 is genuinely unavailable — then a still stands in for the field. */
  const [noGl, setNoGl] = useState(false)

  useEffect(() => {
    const el = canvas.current
    const box = host.current
    if (!el || !box) return

    const gl = el.getContext("webgl2", { alpha: true, antialias: false, premultipliedAlpha: true })
    if (!gl) {
      // Async so this is not a synchronous setState inside an effect (react-hooks lint), and
      // so a machine without WebGL2 gets the still rather than an empty band.
      const id = setTimeout(() => setNoGl(true), 0)
      return () => clearTimeout(id)
    }

    const program = gl.createProgram()!
    for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]] as const) {
      const sh = gl.createShader(type)!
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        // A shader that will not compile is a blank band, so say why in the console and fall
        // back rather than leaving a hole with no explanation.
        console.error("[band-chrome]", gl.getShaderInfoLog(sh))
        const id = setTimeout(() => setNoGl(true), 0)
        return () => clearTimeout(id)
      }
      gl.attachShader(program, sh)
    }
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("[band-chrome]", gl.getProgramInfoLog(program))
      const id = setTimeout(() => setNoGl(true), 0)
      return () => clearTimeout(id)
    }
    gl.useProgram(program)

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(program, "aPos")
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

    const uRes = gl.getUniformLocation(program, "uRes")
    const uTime = gl.getUniformLocation(program, "uTime")
    const uPointer = gl.getUniformLocation(program, "uPointer")
    const uPush = gl.getUniformLocation(program, "uPush")

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

    /* HALF RESOLUTION, scaled back up by CSS. At band size the field is soft and nobody can
       tell; it quarters the fragments, which is the difference between this being affordable
       on a header and not. */
    /* Half of the DEVICE resolution, not of CSS pixels. Scaling the CSS box by 0.5 on a 2x
       screen gave a buffer a quarter the size of the pixels it was stretched over, which is
       why the first render looked like a thumbnail of itself. */
    const SCALE = 0.5 * Math.min(window.devicePixelRatio || 1, 2)
    let w = 0
    let h = 0
    const resize = () => {
      const r = box.getBoundingClientRect()
      const nw = Math.max(1, Math.round(r.width * SCALE))
      const nh = Math.max(1, Math.round(r.height * SCALE))
      if (nw === w && nh === h) return
      w = nw; h = nh
      el.width = w; el.height = h
      gl.viewport(0, 0, w, h)
      gl.uniform2f(uRes, w, h)
    }
    resize()

    /* The pointer in FIELD space, not pixels: x is in units of half-height either side of
       centre, which is the space the shader marches in. */
    let pointer: [number, number] = [-100, -100]
    const onMove = (e: PointerEvent) => {
      const r = box.getBoundingClientRect()
      pointer = [
        ((e.clientX - r.left) - r.width * 0.5) / r.height,
        -(((e.clientY - r.top) - r.height * 0.5) / r.height),
      ]
    }
    const onLeave = () => { pointer = [-100, -100] }

    const still = window.matchMedia("(prefers-reduced-motion: reduce)")
    let raf = 0
    let last = 0
    let visible = true
    const start = performance.now()

    const draw = (time: number) => {
      gl.uniform1f(uTime, time)
      gl.uniform2f(uPointer, pointer[0], pointer[1])
      gl.uniform1f(uPush, 0.55)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    /* 30fps on an accumulator. A header does not need 120, and the difference is half the GPU
       time on a machine that is also running the factory floor. */
    const FRAME = 1000 / 30
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (now - last < FRAME) return
      last = now
      resize()
      draw((now - start) / 1000)
    }

    const run = () => {
      if (raf || !visible) return
      last = 0
      raf = requestAnimationFrame(loop)
    }
    const stop = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    }

    if (still.matches) {
      /* ONE FRAME, then nothing. Not a blank canvas: what this figure is made of is the
         material, and a still chrome field is the honest reduced-motion version of it. */
      resize()
      draw(6.5)
    } else {
      run()
      box.addEventListener("pointermove", onMove)
      box.addEventListener("pointerleave", onLeave)
    }

    /* Off-screen and hidden tabs stop the loop outright. */
    const io = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? true
      if (still.matches) return
      if (visible) run(); else stop()
    })
    io.observe(box)
    const onVis = () => {
      if (still.matches) return
      if (document.hidden) stop(); else run()
    }
    document.addEventListener("visibilitychange", onVis)
    const ro = new ResizeObserver(() => { resize(); if (still.matches) draw(6.5) })
    ro.observe(box)

    return () => {
      stop()
      io.disconnect()
      ro.disconnect()
      document.removeEventListener("visibilitychange", onVis)
      box.removeEventListener("pointermove", onMove)
      box.removeEventListener("pointerleave", onLeave)
      gl.deleteProgram(program)
      gl.deleteBuffer(buf)
      /* NO loseContext() HERE. It is the tidy-looking line that broke this: killing the
         context is permanent for that canvas, and React's development double-mount then runs
         the effect again on the SAME element — where every call now fails against a dead
         context, and a dead context returns EMPTY info logs, so it presented as "the shader
         will not compile" with nothing to read. The context goes when the canvas is collected;
         deleting the program and the buffer is all that belongs here. */
    }
  }, [])

  return (
    <div ref={host} aria-hidden className="eg-chrome-wrap">
      {noGl ? (
        // The already-generated still, so a machine without WebGL2 gets chrome rather than a hole.
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/ploy/obj/liquid-chrome.webp" alt="" className="eg-chrome-still" />
      ) : (
        <canvas ref={canvas} className="eg-chrome-canvas" />
      )}
    </div>
  )
}
