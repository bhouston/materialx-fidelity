import {
  abs,
  add,
  clamp,
  floor,
  ceil,
  round,
  sign,
  sin,
  cos,
  tan,
  asin,
  acos,
  sqrt,
  log,
  exp,
  min,
  max,
  normalize,
  length,
  dot,
  cross,
  mul,
  div,
  pow,
  distance,
  remap,
  smoothstep,
  luminance,
  mx_rgbtohsv,
  mx_hsvtorgb,
  mix,
  saturation as mx_saturation,
  transpose,
  determinant,
  inverse,
  normalMap,
  mat3,
  mx_ramplr,
  mx_ramptb,
  mx_splitlr,
  mx_splittb,
  mx_fractal_noise_float,
  mx_noise_float,
  mx_cell_noise_float,
  mx_worley_noise_float,
  mx_unifiednoise2d,
  mx_unifiednoise3d,
  mx_place2d,
  mx_safepower,
  mx_contrast,
  element,
  reflect,
  refract,
  mx_timer,
  mx_frame,
  mx_ifgreater,
  mx_ifgreatereq,
  mx_ifequal,
  mx_atan2,
  positionLocal,
  mx_heighttonormal,
  float,
  int,
  color,
  vec2,
  vec3,
  vec4,
  checker,
  fract,
  sub,
  step,
} from 'three/tsl';

class MXElement {
  constructor(name, nodeFunc, params = [], defaults = {}) {
    this.name = name;
    this.nodeFunc = nodeFunc;
    this.params = params;
    this.defaults = defaults;
  }
}

const mx_invert = (inNode, amount = 1) => sub(amount, inNode);

const mx_range = (inNode, inLow, inHigh, outLow, outHigh, gamma = 1) => {
  const inSpan = max(sub(inHigh, inLow), 1e-6);
  const normalized = div(sub(inNode, inLow), inSpan);
  const reciprocalGamma = div(1, gamma);
  const gammaApplied = mul(pow(abs(normalized), reciprocalGamma), sign(normalized));
  return add(outLow, mul(gammaApplied, sub(outHigh, outLow)));
};

const mx_and = (in1, in2) => clamp(mul(in1, in2), float(0), float(1));
const mx_or = (in1, in2) => clamp(add(in1, in2), float(0), float(1));
const mx_xor = (in1, in2) => abs(sub(in1, in2));
const mx_not = (inNode) => sub(float(1), inNode);
// TSL conditional helpers currently pick the opposite branch ordering relative to MaterialX.
// Normalize here so all MaterialX nodes keep "condition ? in1 : in2" semantics.
const mx_ifgreater_materialx = (value1, value2, in1, in2) => mx_ifgreater(value1, value2, in2, in1);
const mx_ifgreatereq_materialx = (value1, value2, in1, in2) => mx_ifgreatereq(value1, value2, in2, in1);
const mx_ifequal_materialx = (value1, value2, in1, in2) => mx_ifequal(value1, value2, in2, in1);
const mx_checkerboard = (color1, color2, texcoord) => mix(color1, color2, clamp(checker(texcoord), 0, 1));

// Match MaterialX smoothstep semantics for degenerate ranges:
// when high <= low, behave like step(high, in) instead of relying on GPU undefined behavior.
const mx_smoothstep_materialx = (inNode, low = 0, high = 1) => {
  const hermite = smoothstep(low, high, inNode);
  const fallback = step(high, inNode);
  const useFallback = step(high, low);
  return mix(hermite, fallback, useFallback);
};

const mx_circle = (texcoord, center, radius) => {
  const delta = sub(texcoord, center);
  const distanceSquared = dot(delta, delta);
  const radiusSquared = mul(radius, radius);
  return mx_ifgreater_materialx(distanceSquared, radiusSquared, 0, 1);
};

const mx_bump = (height, scale = 1) => normalMap(mx_heighttonormal(height, 1), scale);
const mx_dot = (inNode) => inNode;
const getRGBChannels = (input) => vec3(element(input, 0), element(input, 1), element(input, 2));
const mx_blackbody = (temperature = 5000) => {
  const temperatureKelvin = clamp(temperature, float(800), float(25000));
  const t = div(float(1000), temperatureKelvin);
  const t2 = mul(t, t);
  const t3 = mul(t2, t);
  const lowX = add(add(mul(float(-0.2661239), t3), mul(float(-0.234358), t2)), add(mul(float(0.8776956), t), float(0.17991)));
  const highX = add(
    add(mul(float(-3.0258469), t3), mul(float(2.1070379), t2)),
    add(mul(float(0.2226347), t), float(0.24039)),
  );
  const xc = mx_ifgreatereq_materialx(temperatureKelvin, float(4000), highX, lowX);
  const xc2 = mul(xc, xc);
  const xc3 = mul(xc2, xc);
  const ycLow = add(
    add(mul(float(-1.1063814), xc3), mul(float(-1.3481102), xc2)),
    add(mul(float(2.18555832), xc), float(-0.20219683)),
  );
  const ycMid = add(
    add(mul(float(-0.9549476), xc3), mul(float(-1.37418593), xc2)),
    add(mul(float(2.09137015), xc), float(-0.16748867)),
  );
  const ycHigh = add(
    add(mul(float(3.081758), xc3), mul(float(-5.8733867), xc2)),
    add(mul(float(3.75112997), xc), float(-0.37001483)),
  );
  const ycLowMid = mx_ifgreatereq_materialx(temperatureKelvin, float(2222), ycMid, ycLow);
  const yc = mx_ifgreatereq_materialx(temperatureKelvin, float(4000), ycHigh, ycLowMid);
  const safeYc = max(yc, float(1e-6));
  const xyz = vec3(div(xc, safeYc), float(1), div(sub(sub(float(1), xc), yc), safeYc));
  const rgb = vec3(
    add(add(mul(float(3.2406), element(xyz, 0)), mul(float(-1.5372), element(xyz, 1))), mul(float(-0.4986), element(xyz, 2))),
    add(add(mul(float(-0.9689), element(xyz, 0)), mul(float(1.8758), element(xyz, 1))), mul(float(0.0415), element(xyz, 2))),
    add(add(mul(float(0.0557), element(xyz, 0)), mul(float(-0.204), element(xyz, 1))), mul(float(1.057), element(xyz, 2))),
  );
  const clampedRgb = max(rgb, vec3(0, 0, 0));
  const validYcMask = step(float(1e-6), yc);
  return mix(vec3(1, 1, 1), clampedRgb, validYcMask);
};

const mx_unpremult = (input) => {
  const alpha = element(input, 3);
  const rgb = getRGBChannels(input);
  const unpremultiplied = alpha.equal(0).mix(rgb, div(rgb, alpha));
  return vec4(unpremultiplied, alpha);
};

const mx_colorcorrect = (
  input,
  hue = 0,
  saturationAmount = 1,
  gamma = 1,
  lift = 0,
  gain = 1,
  contrast = 1,
  contrastPivot = 0.5,
  exposure = 0,
) => {
  const rgbInput = getRGBChannels(input);
  const hsv = mx_rgbtohsv(rgbInput);
  const hueAdjusted = mx_hsvtorgb(add(hsv, vec3(hue, 0, 0)));
  const saturationAdjusted = mx_saturation(hueAdjusted, saturationAmount);
  const gammaAdjusted = mx_range(saturationAdjusted, 0, 1, 0, 1, gamma);
  const liftApplied = add(mul(gammaAdjusted, sub(1, lift)), lift);
  const gainApplied = mul(liftApplied, gain);
  const contrastApplied = mx_contrast(gainApplied, contrast, contrastPivot);
  const exposureApplied = mul(contrastApplied, pow(2, exposure));
  const preserveAlpha = input && (input.nodeType === 'vec4' || input.nodeType === 'color4');
  return preserveAlpha ? vec4(exposureApplied, element(input, 3)) : exposureApplied;
};

const mx_minus = (fg, bg, mixval = 1) => add(mul(mixval, sub(bg, fg)), mul(sub(1, mixval), bg));
const mx_difference = (fg, bg, mixval = 1) => add(mul(mixval, abs(sub(bg, fg))), mul(sub(1, mixval), bg));
const mx_mod = (in1, in2) => sub(in1, mul(in2, floor(div(in1, in2))));

const mx_burn_channel = (fg, bg, mixval = 1) => {
  const composed = add(mul(mixval, sub(1, div(sub(1, bg), fg))), mul(sub(1, mixval), bg));
  return mul(composed, step(float(1e-6), abs(fg)));
};

const mx_dodge_channel = (fg, bg, mixval = 1) => {
  const composed = add(mul(mixval, div(bg, sub(1, fg))), mul(sub(1, mixval), bg));
  return mul(composed, step(float(1e-6), abs(sub(1, fg))));
};

const isVec3Like = (node) =>
  node && (node.nodeType === 'vec3' || node.nodeType === 'color' || node.nodeType === 'color3');
const isVec4Like = (node) => node && (node.nodeType === 'vec4' || node.nodeType === 'color4');

const mx_burn = (fg, bg, mixval = 1) => {
  if (isVec4Like(fg) || isVec4Like(bg)) {
    return vec4(
      mx_burn_channel(element(fg, 0), element(bg, 0), mixval),
      mx_burn_channel(element(fg, 1), element(bg, 1), mixval),
      mx_burn_channel(element(fg, 2), element(bg, 2), mixval),
      mx_burn_channel(element(fg, 3), element(bg, 3), mixval),
    );
  }

  if (isVec3Like(fg) || isVec3Like(bg)) {
    return vec3(
      mx_burn_channel(element(fg, 0), element(bg, 0), mixval),
      mx_burn_channel(element(fg, 1), element(bg, 1), mixval),
      mx_burn_channel(element(fg, 2), element(bg, 2), mixval),
    );
  }

  return mx_burn_channel(fg, bg, mixval);
};

const mx_dodge = (fg, bg, mixval = 1) => {
  if (isVec4Like(fg) || isVec4Like(bg)) {
    return vec4(
      mx_dodge_channel(element(fg, 0), element(bg, 0), mixval),
      mx_dodge_channel(element(fg, 1), element(bg, 1), mixval),
      mx_dodge_channel(element(fg, 2), element(bg, 2), mixval),
      mx_dodge_channel(element(fg, 3), element(bg, 3), mixval),
    );
  }

  if (isVec3Like(fg) || isVec3Like(bg)) {
    return vec3(
      mx_dodge_channel(element(fg, 0), element(bg, 0), mixval),
      mx_dodge_channel(element(fg, 1), element(bg, 1), mixval),
      mx_dodge_channel(element(fg, 2), element(bg, 2), mixval),
    );
  }

  return mx_dodge_channel(fg, bg, mixval);
};

const mx_ramp4 = (valuetl, valuetr, valuebl, valuebr, texcoord = vec2(0, 0)) => {
  const clamped = clamp(texcoord, vec2(0, 0), vec2(1, 1));
  const s = element(clamped, 0);
  const t = element(clamped, 1);
  const topMix = mix(valuetl, valuetr, s);
  const bottomMix = mix(valuebl, valuebr, s);
  return mix(bottomMix, topMix, t);
};

const mx_rotate2d_materialx = (inNode, amount = 0) => {
  const rotationRadians = mul(amount, Math.PI / 180.0);
  const sa = sin(rotationRadians);
  const ca = cos(rotationRadians);
  const x = element(inNode, 0);
  const y = element(inNode, 1);
  return vec2(add(mul(ca, x), mul(sa, y)), sub(mul(ca, y), mul(sa, x)));
};

const mx_rotate3d_materialx = (inNode, amount = 0, axis = vec3(0, 1, 0)) => {
  const normalizedAxis = normalize(axis);
  const rotationRadians = mul(amount, Math.PI / 180.0);
  const s = sin(rotationRadians);
  const c = cos(rotationRadians);
  const oc = sub(1, c);

  const x = element(inNode, 0);
  const y = element(inNode, 1);
  const z = element(inNode, 2);
  const ax = element(normalizedAxis, 0);
  const ay = element(normalizedAxis, 1);
  const az = element(normalizedAxis, 2);

  const m00 = add(mul(mul(oc, ax), ax), c);
  const m01 = sub(mul(mul(oc, ax), ay), mul(az, s));
  const m02 = add(mul(mul(oc, az), ax), mul(ay, s));

  const m10 = add(mul(mul(oc, ax), ay), mul(az, s));
  const m11 = add(mul(mul(oc, ay), ay), c);
  const m12 = sub(mul(mul(oc, ay), az), mul(ax, s));

  const m20 = sub(mul(mul(oc, az), ax), mul(ay, s));
  const m21 = add(mul(mul(oc, ay), az), mul(ax, s));
  const m22 = add(mul(mul(oc, az), az), c);

  return vec3(
    add(add(mul(m00, x), mul(m01, y)), mul(m02, z)),
    add(add(mul(m10, x), mul(m11, y)), mul(m12, z)),
    add(add(mul(m20, x), mul(m21, y)), mul(m22, z)),
  );
};

const mx_ramp_gradient = (
  x = 0,
  interval1 = 0,
  interval2 = 1,
  color1 = vec4(0, 0, 0, 1),
  color2 = vec4(1, 1, 1, 1),
  interpolation = 1,
  prevColor = vec4(0, 0, 0, 1),
  intervalNum = 1,
  numIntervals = 2,
) => {
  const xFloat = float(x);
  const interval1Float = float(interval1);
  const interval2Float = float(interval2);
  const interpolationFloat = float(interpolation);
  const intervalNumFloat = float(intervalNum);
  const numIntervalsFloat = float(numIntervals);
  const mixColor4 = (bg, fg, factor) =>
    vec4(
      mix(element(bg, 0), element(fg, 0), factor),
      mix(element(bg, 1), element(fg, 1), factor),
      mix(element(bg, 2), element(fg, 2), factor),
      mix(element(bg, 3), element(fg, 3), factor),
    );
  const linearClamped = clamp(xFloat, interval1Float, interval2Float);
  const rangeSize = sub(interval2Float, interval1Float);
  const safeRange = max(rangeSize, float(1e-6));
  const linearRemap = div(sub(linearClamped, interval1Float), safeRange);
  const smoothVal = smoothstep(interval1Float, interval2Float, xFloat);
  const interpolationDistanceToLinear = abs(sub(interpolationFloat, float(0)));
  const useLinear = sub(float(1), step(float(0.5), interpolationDistanceToLinear));
  const interpFactor = mix(smoothVal, linearRemap, useLinear);
  const mixedColor = mixColor4(color1, color2, interpFactor);
  const stepColor = mixColor4(color1, color2, step(interval2Float, xFloat));
  const interpolationDistanceToStep = abs(sub(interpolationFloat, float(2)));
  const useStep = sub(float(1), step(float(0.5), interpolationDistanceToStep));
  const interpolated = mixColor4(mixedColor, stepColor, useStep);
  const withinInterval = mixColor4(prevColor, interpolated, step(add(interval1Float, float(1e-6)), xFloat));
  return mixColor4(withinInterval, prevColor, step(numIntervalsFloat, intervalNumFloat));
};

const defaultFloat = (value) => () => float(value);
const defaultInt = (value) => () => int(value);
const defaultBool = (value) => () => float(value ? 1 : 0);
const defaultColor = (r, g, b) => () => color(r, g, b);
const defaultVec2 = (x, y) => () => vec2(x, y);
const defaultVec3 = (x, y, z) => () => vec3(x, y, z);
const defaultVec4 = (x, y, z, w) => () => vec4(x, y, z, w);

const MXElements = [
  new MXElement('add', add, ['in1', 'in2'], { in1: defaultFloat(0), in2: defaultFloat(0) }),
  new MXElement('subtract', sub, ['in1', 'in2'], { in1: defaultFloat(0), in2: defaultFloat(0) }),
  new MXElement('multiply', mul, ['in1', 'in2'], { in1: defaultFloat(0), in2: defaultFloat(1) }),
  new MXElement('divide', div, ['in1', 'in2'], { in1: defaultFloat(0), in2: defaultFloat(1) }),
  new MXElement('modulo', mx_mod, ['in1', 'in2'], { in1: defaultFloat(0), in2: defaultFloat(1) }),
  new MXElement('absval', abs, ['in'], { in: defaultFloat(0) }),
  new MXElement('sign', sign, ['in'], { in: defaultFloat(0) }),
  new MXElement('floor', floor, ['in'], { in: defaultFloat(0) }),
  new MXElement('ceil', ceil, ['in'], { in: defaultFloat(0) }),
  new MXElement('round', round, ['in'], { in: defaultFloat(0) }),
  new MXElement('power', pow, ['in1', 'in2'], { in1: defaultFloat(0), in2: defaultFloat(1) }),
  new MXElement('sin', sin, ['in'], { in: defaultFloat(0) }),
  new MXElement('cos', cos, ['in'], { in: defaultFloat(0) }),
  new MXElement('tan', tan, ['in'], { in: defaultFloat(0) }),
  new MXElement('asin', asin, ['in'], { in: defaultFloat(0) }),
  new MXElement('acos', acos, ['in'], { in: defaultFloat(0) }),
  new MXElement('atan2', mx_atan2, ['iny', 'inx'], { iny: defaultFloat(0), inx: defaultFloat(1) }),
  new MXElement('sqrt', sqrt, ['in'], { in: defaultFloat(0) }),
  new MXElement('ln', log, ['in'], { in: defaultFloat(1) }),
  new MXElement('exp', exp, ['in'], { in: defaultFloat(0) }),
  new MXElement('fract', fract, ['in'], { in: defaultFloat(0) }),
  new MXElement('clamp', clamp, ['in', 'low', 'high'], {
    in: defaultFloat(0),
    low: defaultFloat(0),
    high: defaultFloat(1),
  }),
  new MXElement('min', min, ['in1', 'in2'], { in1: defaultFloat(0), in2: defaultFloat(0) }),
  new MXElement('max', max, ['in1', 'in2'], { in1: defaultFloat(0), in2: defaultFloat(0) }),
  new MXElement('normalize', normalize, ['in'], { in: defaultFloat(0) }),
  new MXElement('magnitude', length, ['in'], { in: defaultFloat(0) }),
  new MXElement('length', length, ['in'], { in: defaultFloat(0) }),
  new MXElement('dot', mx_dot, ['in'], { in: defaultFloat(0) }),
  new MXElement('dotproduct', dot, ['in1', 'in2'], { in1: defaultFloat(0), in2: defaultFloat(0) }),
  new MXElement('crossproduct', cross, ['in1', 'in2'], { in1: defaultVec3(0, 0, 0), in2: defaultVec3(0, 0, 0) }),
  new MXElement('distance', distance, ['in1', 'in2'], { in1: defaultFloat(0), in2: defaultFloat(0) }),
  new MXElement('invert', mx_invert, ['in', 'amount'], { in: defaultFloat(0), amount: defaultFloat(1) }),
  new MXElement('transformmatrix', mul, ['in', 'mat'], { in: defaultFloat(0) }),
  new MXElement('normalmap', normalMap, ['in', 'scale'], { in: defaultVec3(0.5, 0.5, 1.0), scale: defaultFloat(1) }),
  new MXElement('transpose', transpose, ['in']),
  new MXElement('determinant', determinant, ['in']),
  new MXElement('invertmatrix', inverse, ['in']),
  new MXElement('creatematrix', mat3, ['in1', 'in2', 'in3'], {
    in1: defaultVec3(1, 0, 0),
    in2: defaultVec3(0, 1, 0),
    in3: defaultVec3(0, 0, 1),
  }),
  new MXElement('remap', remap, ['in', 'inlow', 'inhigh', 'outlow', 'outhigh'], {
    in: defaultFloat(0),
    inlow: defaultFloat(0),
    inhigh: defaultFloat(1),
    outlow: defaultFloat(0),
    outhigh: defaultFloat(1),
  }),
  new MXElement('range', mx_range, ['in', 'inlow', 'inhigh', 'outlow', 'outhigh', 'gamma'], {
    in: defaultFloat(0),
    inlow: defaultFloat(0),
    inhigh: defaultFloat(1),
    outlow: defaultFloat(0),
    outhigh: defaultFloat(1),
    gamma: defaultFloat(1),
  }),
  new MXElement('smoothstep', mx_smoothstep_materialx, ['in', 'low', 'high'], {
    in: defaultFloat(0),
    low: defaultFloat(0),
    high: defaultFloat(1),
  }),
  new MXElement('luminance', luminance, ['in', 'lumacoeffs'], {
    in: defaultColor(0, 0, 0),
    lumacoeffs: defaultColor(0.2722287, 0.6740818, 0.0536895),
  }),
  new MXElement('rgbtohsv', mx_rgbtohsv, ['in'], { in: defaultColor(0, 0, 0) }),
  new MXElement('hsvtorgb', mx_hsvtorgb, ['in'], { in: defaultColor(0, 0, 0) }),
  new MXElement('mix', mix, ['bg', 'fg', 'mix'], { bg: defaultFloat(0), fg: defaultFloat(0), mix: defaultFloat(0) }),
  new MXElement('minus', mx_minus, ['fg', 'bg', 'mix'], {
    fg: defaultFloat(0),
    bg: defaultFloat(0),
    mix: defaultFloat(1),
  }),
  new MXElement('difference', mx_difference, ['fg', 'bg', 'mix'], {
    fg: defaultFloat(0),
    bg: defaultFloat(0),
    mix: defaultFloat(1),
  }),
  new MXElement('burn', mx_burn, ['fg', 'bg', 'mix'], {
    fg: defaultFloat(0),
    bg: defaultFloat(0),
    mix: defaultFloat(1),
  }),
  new MXElement('dodge', mx_dodge, ['fg', 'bg', 'mix'], {
    fg: defaultFloat(0),
    bg: defaultFloat(0),
    mix: defaultFloat(1),
  }),
  new MXElement(
    'colorcorrect',
    mx_colorcorrect,
    ['in', 'hue', 'saturation', 'gamma', 'lift', 'gain', 'contrast', 'contrastpivot', 'exposure'],
    {
      in: defaultColor(1, 1, 1),
      hue: defaultFloat(0),
      saturation: defaultFloat(1),
      gamma: defaultFloat(1),
      lift: defaultFloat(0),
      gain: defaultFloat(1),
      contrast: defaultFloat(1),
      contrastpivot: defaultFloat(0.5),
      exposure: defaultFloat(0),
    },
  ),
  new MXElement('unpremult', mx_unpremult, ['in'], { in: defaultVec4(0, 0, 0, 1) }),
  new MXElement('combine2', vec2, ['in1', 'in2'], { in1: defaultFloat(0), in2: defaultFloat(0) }),
  new MXElement('combine3', vec3, ['in1', 'in2', 'in3'], {
    in1: defaultFloat(0),
    in2: defaultFloat(0),
    in3: defaultFloat(0),
  }),
  new MXElement('combine4', vec4, ['in1', 'in2', 'in3', 'in4'], {
    in1: defaultFloat(0),
    in2: defaultFloat(0),
    in3: defaultFloat(0),
    in4: defaultFloat(0),
  }),
  new MXElement('ramplr', mx_ramplr, ['valuel', 'valuer', 'texcoord'], {
    valuel: defaultFloat(0),
    valuer: defaultFloat(0),
  }),
  new MXElement('ramptb', mx_ramptb, ['valuet', 'valueb', 'texcoord'], {
    valuet: defaultFloat(0),
    valueb: defaultFloat(0),
  }),
  new MXElement('ramp4', mx_ramp4, ['valuetl', 'valuetr', 'valuebl', 'valuebr', 'texcoord'], {
    valuetl: defaultColor(0, 0, 0),
    valuetr: defaultColor(0, 0, 0),
    valuebl: defaultColor(0, 0, 0),
    valuebr: defaultColor(0, 0, 0),
    texcoord: defaultVec2(0, 0),
  }),
  new MXElement(
    'ramp_gradient',
    mx_ramp_gradient,
    ['x', 'interval1', 'interval2', 'color1', 'color2', 'interpolation', 'prev_color', 'interval_num', 'num_intervals'],
    {
      x: defaultFloat(0),
      interval1: defaultFloat(0),
      interval2: defaultFloat(1),
      color1: defaultVec4(0, 0, 0, 1),
      color2: defaultVec4(1, 1, 1, 1),
      interpolation: defaultFloat(1),
      prev_color: defaultVec4(0, 0, 0, 1),
      interval_num: defaultFloat(1),
      num_intervals: defaultFloat(2),
    },
  ),
  new MXElement('splitlr', mx_splitlr, ['valuel', 'valuer', 'center', 'texcoord'], {
    valuel: defaultFloat(0),
    valuer: defaultFloat(0),
    center: defaultFloat(0.5),
  }),
  new MXElement('splittb', mx_splittb, ['valuet', 'valueb', 'center', 'texcoord'], {
    valuet: defaultFloat(0),
    valueb: defaultFloat(0),
    center: defaultFloat(0.5),
  }),
  new MXElement('noise2d', mx_noise_float, ['texcoord', 'amplitude', 'pivot'], {
    amplitude: defaultFloat(1),
    pivot: defaultFloat(0),
  }),
  new MXElement('noise3d', mx_noise_float, ['texcoord', 'amplitude', 'pivot'], {
    amplitude: defaultFloat(1),
    pivot: defaultFloat(0),
  }),
  new MXElement('fractal3d', mx_fractal_noise_float, ['position', 'octaves', 'lacunarity', 'diminish', 'amplitude'], {
    position: () => positionLocal,
    octaves: defaultInt(3),
    lacunarity: defaultFloat(2.0),
    diminish: defaultFloat(0.5),
    amplitude: defaultFloat(1.0),
  }),
  new MXElement('cellnoise2d', mx_cell_noise_float, ['texcoord']),
  new MXElement('cellnoise3d', mx_cell_noise_float, ['texcoord']),
  new MXElement('worleynoise2d', mx_worley_noise_float, ['texcoord', 'jitter'], { jitter: defaultFloat(1) }),
  new MXElement('worleynoise3d', mx_worley_noise_float, ['texcoord', 'jitter'], { jitter: defaultFloat(1) }),
  new MXElement(
    'unifiednoise2d',
    mx_unifiednoise2d,
    [
      'type',
      'texcoord',
      'freq',
      'offset',
      'jitter',
      'outmin',
      'outmax',
      'clampoutput',
      'octaves',
      'lacunarity',
      'diminish',
    ],
    {
      type: defaultInt(0),
      freq: defaultVec2(1, 1),
      offset: defaultVec2(0, 0),
      jitter: defaultFloat(1),
      outmin: defaultFloat(0),
      outmax: defaultFloat(1),
      clampoutput: defaultBool(true),
      octaves: defaultInt(3),
      lacunarity: defaultFloat(2),
      diminish: defaultFloat(0.5),
    },
  ),
  new MXElement(
    'unifiednoise3d',
    mx_unifiednoise3d,
    [
      'type',
      'texcoord',
      'freq',
      'offset',
      'jitter',
      'outmin',
      'outmax',
      'clampoutput',
      'octaves',
      'lacunarity',
      'diminish',
    ],
    {
      type: defaultInt(0),
      freq: defaultVec3(1, 1, 1),
      offset: defaultVec3(0, 0, 0),
      jitter: defaultFloat(1),
      outmin: defaultFloat(0),
      outmax: defaultFloat(1),
      clampoutput: defaultBool(true),
      octaves: defaultInt(3),
      lacunarity: defaultFloat(2),
      diminish: defaultFloat(0.5),
    },
  ),
  new MXElement('place2d', mx_place2d, ['texcoord', 'pivot', 'scale', 'rotate', 'offset', 'operationorder'], {
    texcoord: defaultVec2(0, 0),
    pivot: defaultVec2(0, 0),
    scale: defaultVec2(1, 1),
    rotate: defaultFloat(0),
    offset: defaultVec2(0, 0),
    operationorder: defaultInt(0),
  }),
  new MXElement('safepower', mx_safepower, ['in1', 'in2'], { in1: defaultFloat(0), in2: defaultFloat(1) }),
  new MXElement('contrast', mx_contrast, ['in', 'amount', 'pivot'], {
    in: defaultFloat(0),
    amount: defaultFloat(1),
    pivot: defaultFloat(0.5),
  }),
  new MXElement('saturate', mx_saturation, ['in', 'amount'], { in: defaultColor(0, 0, 0), amount: defaultFloat(1) }),
  new MXElement('extract', element, ['in', 'index'], { in: defaultFloat(0), index: defaultInt(0) }),
  new MXElement('separate2', element, ['in'], { in: defaultVec2(0, 0) }),
  new MXElement('separate3', element, ['in'], { in: defaultVec3(0, 0, 0) }),
  new MXElement('separate4', element, ['in'], { in: defaultVec4(0, 0, 0, 0) }),
  new MXElement('reflect', reflect, ['in', 'normal'], { in: defaultVec3(1, 0, 0) }),
  new MXElement('refract', refract, ['in', 'normal', 'ior'], { in: defaultVec3(1, 0, 0), ior: defaultFloat(1) }),
  new MXElement('time', mx_timer),
  new MXElement('frame', mx_frame),
  new MXElement('ifgreater', mx_ifgreater_materialx, ['value1', 'value2', 'in1', 'in2'], {
    value1: defaultFloat(1),
    value2: defaultFloat(0),
    in1: defaultFloat(0),
    in2: defaultFloat(0),
  }),
  new MXElement('ifgreatereq', mx_ifgreatereq_materialx, ['value1', 'value2', 'in1', 'in2'], {
    value1: defaultFloat(1),
    value2: defaultFloat(0),
    in1: defaultFloat(0),
    in2: defaultFloat(0),
  }),
  new MXElement('ifequal', mx_ifequal_materialx, ['value1', 'value2', 'in1', 'in2'], {
    value1: defaultFloat(0),
    value2: defaultFloat(0),
    in1: defaultFloat(0),
    in2: defaultFloat(0),
  }),
  new MXElement('rotate2d', mx_rotate2d_materialx, ['in', 'amount'], { in: defaultVec2(0, 0), amount: defaultFloat(0) }),
  new MXElement('rotate3d', mx_rotate3d_materialx, ['in', 'amount', 'axis'], {
    in: defaultVec3(0, 0, 0),
    amount: defaultFloat(0),
    axis: defaultVec3(0, 1, 0),
  }),
  new MXElement('heighttonormal', mx_heighttonormal, ['in', 'scale', 'texcoord'], {
    in: defaultFloat(0),
    scale: defaultFloat(1),
  }),
  new MXElement('and', mx_and, ['in1', 'in2'], { in1: defaultBool(false), in2: defaultBool(false) }),
  new MXElement('or', mx_or, ['in1', 'in2'], { in1: defaultBool(false), in2: defaultBool(false) }),
  new MXElement('xor', mx_xor, ['in1', 'in2'], { in1: defaultBool(false), in2: defaultBool(false) }),
  new MXElement('not', mx_not, ['in'], { in: defaultBool(false) }),
  new MXElement('checkerboard', mx_checkerboard, ['color1', 'color2', 'texcoord'], {
    color1: defaultColor(1, 1, 1),
    color2: defaultColor(0, 0, 0),
    texcoord: defaultVec2(0, 0),
  }),
  new MXElement('circle', mx_circle, ['texcoord', 'center', 'radius'], {
    center: defaultVec2(0, 0),
    radius: defaultFloat(0.5),
  }),
  new MXElement('bump', mx_bump, ['height', 'scale'], { height: defaultFloat(0), scale: defaultFloat(1) }),
  new MXElement('blackbody', mx_blackbody, ['temperature'], { temperature: defaultFloat(5000) }),
];

const MtlXLibrary = {};
for (const entry of MXElements) {
  MtlXLibrary[entry.name] = entry;
}

const SUPPORTED_NODE_CATEGORIES = new Set(MXElements.map((entry) => entry.name));
SUPPORTED_NODE_CATEGORIES.add('surfacematerial');
SUPPORTED_NODE_CATEGORIES.add('standard_surface');
SUPPORTED_NODE_CATEGORIES.add('open_pbr_surface');
SUPPORTED_NODE_CATEGORIES.add('gltf_pbr');
SUPPORTED_NODE_CATEGORIES.add('nodegraph');
SUPPORTED_NODE_CATEGORIES.add('output');
SUPPORTED_NODE_CATEGORIES.add('input');
SUPPORTED_NODE_CATEGORIES.add('constant');
SUPPORTED_NODE_CATEGORIES.add('convert');
SUPPORTED_NODE_CATEGORIES.add('position');
SUPPORTED_NODE_CATEGORIES.add('normal');
SUPPORTED_NODE_CATEGORIES.add('tangent');
SUPPORTED_NODE_CATEGORIES.add('texcoord');
SUPPORTED_NODE_CATEGORIES.add('geomcolor');
SUPPORTED_NODE_CATEGORIES.add('image');
SUPPORTED_NODE_CATEGORIES.add('tiledimage');

export { MtlXLibrary, SUPPORTED_NODE_CATEGORIES };
