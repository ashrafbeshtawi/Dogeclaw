import{n as e}from"./rolldown-runtime.js";import{w as t,x as n}from"./vendor.js";import{n as r}from"./RareUiCredit.js";var i=e(t(),1),a=n(),o=`
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`,s=`
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_color;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.6;
  for (int i = 0; i < 3; i++) {
    v += a * noise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float t = u_time * 0.22;

  vec2 drift = vec2(
    sin(t) + 0.6 * sin(t * 1.7 + 1.3),
    cos(t * 0.8) + 0.6 * cos(t * 1.3 + 2.1)
  );

  vec2 p = vec2(uv.x * 1.8, uv.y * 1.0) + drift * 0.7;

  vec2 q = vec2(fbm(p + drift), fbm(p + vec2(3.2, 1.5) - drift));
  float f = fbm(p + 1.2 * q);

  float g = clamp(1.0 - uv.y, 0.0, 1.0);
  float anchor = smoothstep(0.0, 0.3, uv.y);
  float shade = clamp(g + (f - 0.5) * 0.8 * anchor, 0.0, 1.0);

  vec3 white = vec3(0.99, 1.0, 1.0);
  vec3 light = mix(white, u_color, 0.5);
  vec3 dark = u_color;

  vec3 col = white;
  col = mix(col, light, smoothstep(0.28, 0.52, shade));
  col = mix(col, dark, smoothstep(0.58, 0.88, shade));

  float edge = smoothstep(0.5, 0.49, distance(uv, vec2(0.5)));

  gl_FragColor = vec4(col * edge, edge);
}
`;function c(e){let t=e.replace(`#`,``).trim();t.length===3&&(t=t[0]+t[0]+t[1]+t[1]+t[2]+t[2]);let n=parseInt(t,16);return t.length!==6||Number.isNaN(n)?[.1,.45,.95]:[(n>>16&255)/255,(n>>8&255)/255,(n&255)/255]}function l(e,t,n){let r=e.createShader(t);return r?(e.shaderSource(r,n),e.compileShader(r),e.getShaderParameter(r,e.COMPILE_STATUS)?r:(console.error(e.getShaderInfoLog(r)),e.deleteShader(r),null)):null}var u=({size:e=240,color:t=`#1A73F2`,className:n,style:u,...d})=>{let f=(0,i.useRef)(null);return(0,i.useEffect)(()=>{let n=f.current;if(!n)return;let r=n.getContext(`webgl`,{antialias:!0,alpha:!0});if(!r)return;let i=r.createProgram(),a=l(r,r.VERTEX_SHADER,o),u=l(r,r.FRAGMENT_SHADER,s);if(!i||!a||!u)return;if(r.attachShader(i,a),r.attachShader(i,u),r.linkProgram(i),!r.getProgramParameter(i,r.LINK_STATUS)){console.error(r.getProgramInfoLog(i));return}r.useProgram(i);let d=r.createBuffer();r.bindBuffer(r.ARRAY_BUFFER,d),r.bufferData(r.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),r.STATIC_DRAW);let p=r.getAttribLocation(i,`a_pos`);r.enableVertexAttribArray(p),r.vertexAttribPointer(p,2,r.FLOAT,!1,0,0);let m=r.getUniformLocation(i,`u_resolution`),h=r.getUniformLocation(i,`u_time`);r.uniform3f(r.getUniformLocation(i,`u_color`),...c(t));let g=Math.min(window.devicePixelRatio||1,2),_=Math.round(e*g);n.width=_,n.height=_,r.viewport(0,0,_,_),r.uniform2f(m,_,_);let v=window.matchMedia(`(prefers-reduced-motion: reduce)`).matches,y=performance.now(),b=0,x=e=>{r.uniform1f(h,v?0:(e-y)/1e3),r.drawArrays(r.TRIANGLES,0,6),v||(b=requestAnimationFrame(x))};return x(y),()=>{cancelAnimationFrame(b),r.deleteProgram(i),r.deleteShader(a),r.deleteShader(u),r.deleteBuffer(d)}},[e,t]),(0,a.jsx)(`div`,{"data-slot":`fluid-orb`,className:r(`relative overflow-hidden rounded-full`,n),style:{width:e,height:e,...u},...d,children:(0,a.jsx)(`canvas`,{ref:f,className:`h-full w-full`})})};export{u as t};