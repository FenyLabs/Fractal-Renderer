const canvas = document.getElementById("webGLCanvas") as HTMLCanvasElement;
const coordDisplay = document.getElementById("coordDisplay") as HTMLElement;
const gl = canvas.getContext("webgl2")!;

if (gl === null) {
    alert("WebGL 2 not supported, please update your browser.");
}

class Point {
    x: number;
    y: number;

    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
    }

    toArray() {
        return [this.x,this.y];
    }

    static fromArray(array: number[]) {
        return new Point(array[0], array[1]);
    }
    
    static duplicate(p: Point): Point {
        return new Point(p.x, p.y);
    }
}

const viewport: {[key: string]: any} = {
    aspectRatio: 1,
    zoom: {
        level: 0,
        log: 1
    },
    offset: {
        pos: new Point(0,0),
        angle: 0
    },
    pointer: {
        lastPos: new Point(0,0),
        lastDist: 0,
        dist: 0,
        lastAngle: 0,
        dragging: false
    },
    settings: {
        iterations: 500,
        breakout: 10000,
        coloring: 1,
        bias: 0,
        hueShift: 0,
        julia: false,
        smooth: false,
        fad: false,
        equation: "z^{2}+c"
    }
};

let currentAST: ParseNode;
let transformUniform: number;
let iterationsUniform: number;
let breakoutUniform: number;
let biasUniform: number;
let hueShiftUniform: number;
let togglesUniform: number;
let aspectUniform: number;
let angleUniform: number;
let colorUniform: number;

loadQueryParams();

const enum paramTypes {string, bool, num, offset, zoom}
function loadQueryParams() {
    const queryParams = new URLSearchParams(window.location.search);
    let iter = queryParams.get('it');
    if (iter !== null && parseInt(iter) > 1000 && !confirm(`High iteration count detected (${iter}), this may lag, would you like to proceed anyways?`)) {
        return;
    }
    setParam(queryParams, paramTypes.string, 'eq', 'equation');
    setParam(queryParams, paramTypes.num, 'it', 'iterations');
    setParam(queryParams, paramTypes.num, 'bk', 'breakout');
    setParam(queryParams, paramTypes.bool, 'jm', 'julia');
    setParam(queryParams, paramTypes.num, 'cm', 'coloring');
    setParam(queryParams, paramTypes.num, 'cb', 'bias');
    setParam(queryParams, paramTypes.num, 'hs', 'hueShift');
    setParam(queryParams, paramTypes.bool, 'sm', 'smooth');
    setParam(queryParams, paramTypes.offset, 'px', 'x');
    setParam(queryParams, paramTypes.offset, 'py', 'y');
    setParam(queryParams, paramTypes.zoom, 'zm', 'level/log');
    setDefaults();
}

function setParam(params: URLSearchParams, type: paramTypes, param: string, setting: string) {
    const currentParam = params.get(param);
    if (currentParam === null) {
        return;
    }
    if (type === paramTypes.string) {
        viewport.settings[setting!] = decodeURI(currentParam);
    } else if (type === paramTypes.bool) {
        viewport.settings[setting!] = currentParam === '1' ? 1 : 0;
    } else if (type === paramTypes.num) {
        viewport.settings[setting!] = parseFloat(currentParam);
    } else if (type === paramTypes.offset) {
        viewport.offset.pos[setting!] = parseFloat(currentParam);
    } else if (type === paramTypes.zoom) {
        const zoom = parseFloat(currentParam)
        viewport.zoom.level = zoom;
        viewport.zoom.log = Math.pow(2,viewport.zoom.level);
    }
}

function setDefaults() {
    ITERATIONS_SLIDER.value = viewport.settings.iterations;
    ITERATIONS_BOX.value = viewport.settings.iterations;
    BREAKOUT_SLIDER.value = viewport.settings.breakout;
    BREAKOUT_BOX.value = viewport.settings.breakout;
    JULIA_TOGGLE.checked = viewport.settings.julia;
    SMOOTH_TOGGLE.checked = viewport.settings.smooth;
    HUESHIFT_SLIDER.value = viewport.settings.hueShift;
    HUESHIFT_BOX.value = viewport.settings.hueShift;
    BIAS_SLIDER.value = viewport.settings.bias;
    BIAS_BOX.value = viewport.settings.bias;
    COLORING_MODE.value = viewport.settings.coloring;
    toggleColoringActive();
}

function setup(manual: boolean) {
    if (RECOMP_TOGGLE.checked && !manual) {
        return;
    }

    let vertexShader = createVertex();
    let fragmentShader = createFragment();
    if (!vertexShader || !fragmentShader) {
        return;
    }

    let program = gl.createProgram()!;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.log(`LINK ERROR: ${gl.getProgramInfoLog(program)}`);
        return;
    }
    transformUniform = gl.getUniformLocation(program, "u_transform")! as number;
    iterationsUniform = gl.getUniformLocation(program, "u_iterations")! as number;
    breakoutUniform = gl.getUniformLocation(program, "u_breakout")! as number;
    biasUniform = gl.getUniformLocation(program, "u_bias")! as number;
    hueShiftUniform = gl.getUniformLocation(program, "u_hueShift")! as number;
    togglesUniform = gl.getUniformLocation(program, "u_toggles")! as number;
    aspectUniform = gl.getUniformLocation(program, "u_aspect")! as number;
    colorUniform = gl.getUniformLocation(program, "u_color")! as number;
    angleUniform = gl.getUniformLocation(program, "u_angle")! as number;
    let posAttrib = gl.getAttribLocation(program, "a_position");

    gl.useProgram(program);

    let vertexData = [-1, -1, -1, 1, 1, 1, -1, -1, 1, 1, 1, -1];
    let posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertexData), gl.STATIC_DRAW);

    gl.enableVertexAttribArray(posAttrib);
    gl.vertexAttribPointer(posAttrib, 2, gl.FLOAT, false, 0, 0);

    requestAnimationFrame(draw);
}

function draw() {
    resize();
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.uniform3fv(transformUniform, [viewport.offset.pos.x, viewport.offset.pos.y, viewport.zoom.log]);
    gl.uniform1i(iterationsUniform, viewport.settings.iterations);
    gl.uniform1i(togglesUniform, viewport.settings.julia + 2*viewport.settings.smooth);
    gl.uniform1i(colorUniform, viewport.settings.coloring);
    gl.uniform1f(breakoutUniform, viewport.settings.breakout);
    gl.uniform1f(biasUniform, viewport.settings.bias);
    gl.uniform1f(hueShiftUniform, viewport.settings.hueShift);
    gl.uniform1f(aspectUniform, viewport.aspectRatio);
    gl.uniform1f(angleUniform, viewport.offset.angle);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    coordDisplay.innerHTML = `Coords: ${viewport.offset.pos.x} + ${viewport.offset.pos.y}i\nZoom: ${viewport.zoom.level}`;
}

function resize() {
    if (canvas.clientHeight !== canvas.height || canvas.clientWidth != canvas.width) {
        canvas.height = canvas.clientHeight;
        canvas.width = canvas.clientWidth;
        viewport.aspectRatio = canvas.clientWidth/canvas.clientHeight;
    }
}

function createVertex() {
    let raw = getVertex();
    let shader = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(shader, raw);
    gl.compileShader(shader);

    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        return shader;
    }

    console.log(`ERROR: ${gl.getShaderInfoLog(shader)}`);
    gl.deleteShader(shader);
}

function createFragment() {
    if (currentAST === null) {
        throw new Error("WebGL Error: No equation provided");
    }
    let raw = getFragment(currentAST, viewport.settings);
    let shader = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(shader, raw);
    gl.compileShader(shader);

    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        return shader;
    }

    console.log(`ERROR: ${gl.getShaderInfoLog(shader)}`);
    gl.deleteShader(shader);
}

function pxToMath(px: Point): Point {
    return new Point(2.0*px.x/canvas.clientWidth*viewport.aspectRatio, 2.0*px.y/canvas.clientHeight);
}

function pxToCanvas(px: Point): Point {
    return new Point((2.0*px.x/canvas.clientWidth - 1)*viewport.aspectRatio, 2.0*px.y/canvas.clientHeight - 1);
}

function resetView() {
    viewport.zoom.level = 0;
    viewport.zoom.log = 1;
    viewport.offset.pos.x = 0;
    viewport.offset.pos.y = 0;
    requestAnimationFrame(draw);
}

function downloadCanvas() {
    draw();
    canvas.toBlob((blob) => {
        if (blob === null) {
            throw new Error("Failed to download file");
        }
        const a = document.createElement('a');
        a.style.display = 'none';
        document.body.appendChild(a);
        const url = window.URL.createObjectURL(blob);
        a.href = url;
        a.download = "fractal.png";
        a.click();
        a.remove();
    });
}

function getURL() {
    setup(true);
    let base = window.location.href.split("?")[0];
    base += `?eq=${encodeURIComponent(viewport.settings.equation)}`;
    base += `&it=${viewport.settings.iterations}`;
    base += `&bk=${viewport.settings.breakout}`;
    base += `&jm=${viewport.settings.julia+0}`;
    base += `&cm=${viewport.settings.coloring}`;
    base += `&cb=${viewport.settings.bias}`;
    base += `&hs=${viewport.settings.hueShift}`;
    base += `&sm=${viewport.settings.smooth+0}`;
    base += `&px=${viewport.offset.pos.x}`;
    base += `&py=${viewport.offset.pos.y}`;
    base += `&zm=${viewport.zoom.level}`;
    return base;
}

const SHARE_POPUP = document.getElementById("sharePopup") as HTMLElement;
const SHARE_INPUT = document.getElementById("shareInput") as HTMLInputElement;
function shareURL() {
    SHARE_POPUP.style.display = "flex";
    SHARE_INPUT.value = getURL();
    SHARE_INPUT.select();
}

window.addEventListener("resize", e => {
    fixGrid();
    requestAnimationFrame(draw);
});


document.addEventListener("mousemove", e => {
    if (e.buttons === 1 && viewport.pointer.dragging) {
        let canvasCoords = canvas.getBoundingClientRect();
        let clickPos = new Point(e.clientX - canvasCoords.left, e.clientY - canvasCoords.top);
        let touchOffset = new Point(clickPos.x - viewport.pointer.lastPos.x, clickPos.y - viewport.pointer.lastPos.y);
        moveDrag(touchOffset);
        viewport.pointer.lastPos = clickPos;
        requestAnimationFrame(draw);
    }
});
canvas.addEventListener("mousedown", e => {
    document.body.style.userSelect = "none";
    let canvasCoords = canvas.getBoundingClientRect();
    let clickPos = new Point(e.clientX - canvasCoords.left, e.clientY - canvasCoords.top);
    viewport.pointer.lastPos = clickPos;
    viewport.pointer.dragging = true;
});
document.addEventListener("mouseup", () => {
    document.body.style.userSelect = "";
    viewport.pointer.dragging = false;
});
canvas.addEventListener("wheel", e => {
    zoomScreen(new Point(e.offsetX,e.offsetY),-0.002*e.deltaY);
    requestAnimationFrame(draw);
});

document.addEventListener("touchmove", e => {
    if (viewport.pointer.dragging) {
        let touches = getTouches(e);
        let touchOffset = new Point(touches.center[0] - viewport.pointer.lastPos.x, touches.center[1] - viewport.pointer.lastPos.y);
        if (viewport.settings.fad) {
            moveDrag(touchOffset, viewport.offset.angle);
        } else {
            moveDrag(touchOffset);
        }
        let zoomFactor;
        if (viewport.pointer.dist > 0) {
            zoomFactor = touches.dist / viewport.pointer.dist;
        } else {
            zoomFactor = 1;
        }
        let centerPoint = Point.fromArray(touches.center);
        scaleScreen(centerPoint, zoomFactor);

        let angleDif = touches.angle - viewport.pointer.lastAngle;
        if (viewport.settings.fad) {
            viewport.offset.angle += Math.atan2(Math.sin(angleDif),Math.cos(angleDif));
        }
        viewport.pointer.lastPos = centerPoint;
        viewport.pointer.lastAngle = touches.angle;
        viewport.pointer.dist = touches.dist;
        requestAnimationFrame(draw);
    }
});

canvas.addEventListener("touchstart", e => {
    document.body.style.userSelect = "none";
    let touches = getTouches(e);
    viewport.pointer.lastPos = Point.fromArray(touches.center);
    viewport.pointer.lastAngle = touches.angle;
    viewport.pointer.dist = touches.dist;
    viewport.pointer.dragging = true;
});
document.addEventListener("touchend", e => {
    document.body.style.userSelect = "";
    viewport.pointer.dragging = false;
});


function moveDrag(coords: Point, angle?: number) {
    let movePos = pxToMath(coords);
    if (angle !== undefined) {
        movePos = new Point(movePos.x * Math.cos(-angle) - movePos.y * Math.sin(-angle), movePos.x * Math.sin(-angle) + movePos.y * Math.cos(-angle));
    }
    viewport.offset.pos.x = viewport.offset.pos.x - movePos.x/viewport.zoom.log;
    viewport.offset.pos.y = viewport.offset.pos.y + movePos.y/viewport.zoom.log;
}

function zoomScreen(coords: Point, zoomAmt: number) {
    let zoomPoint = pxToCanvas(coords);
    viewport.offset.pos.x = viewport.offset.pos.x + zoomPoint.x/viewport.zoom.log;
    viewport.offset.pos.y = viewport.offset.pos.y - zoomPoint.y/viewport.zoom.log;
    viewport.zoom.level += zoomAmt;
    viewport.zoom.log = Math.pow(2,viewport.zoom.level);
    viewport.offset.pos.x = viewport.offset.pos.x - zoomPoint.x/viewport.zoom.log;
    viewport.offset.pos.y = viewport.offset.pos.y + zoomPoint.y/viewport.zoom.log;
}

function scaleScreen(coords: Point, zoomAmt: number) {
    let zoomPoint = pxToCanvas(coords);
    viewport.offset.pos.x = viewport.offset.pos.x + zoomPoint.x/viewport.zoom.log;
    viewport.offset.pos.y = viewport.offset.pos.y - zoomPoint.y/viewport.zoom.log;
    viewport.zoom.log *= zoomAmt;
    viewport.zoom.level = Math.log2(viewport.zoom.log);
    viewport.offset.pos.x = viewport.offset.pos.x - zoomPoint.x/viewport.zoom.log;
    viewport.offset.pos.y = viewport.offset.pos.y + zoomPoint.y/viewport.zoom.log;
}

function getTouches(e: TouchEvent) {
    let canvasCoords = canvas.getBoundingClientRect();
    if (e.touches.length === 1) {
        return {center: [(e.targetTouches[0].pageX - canvasCoords.left), (e.targetTouches[0].pageY - canvasCoords.top)], dist: 0, angle: viewport.pointer.lastAngle};
    } else {
        let total = [0, 0];
        for (let i = 0; i < e.touches.length; i++) {
            total = [total[0] + (e.targetTouches[i].pageX - canvasCoords.left), total[1] + (e.targetTouches[i].pageY - canvasCoords.top)];
        }
        let centerPoint = [total[0]/e.touches.length,total[1]/e.touches.length];
        let centerDistance = Math.sqrt(Math.pow(centerPoint[0] - (e.targetTouches[0].pageX - canvasCoords.left), 2) + Math.pow(centerPoint[1] - (e.targetTouches[0].pageY - canvasCoords.top), 2));
        let angle;
        if (viewport.settings.fad) {
            angle = Math.atan2((e.targetTouches[1].pageY - canvasCoords.top)-(e.targetTouches[0].pageY - canvasCoords.top), (e.targetTouches[1].pageX - canvasCoords.top)-(e.targetTouches[0].pageX - canvasCoords.left))%(2*Math.PI);
        } else {
            angle = viewport.offset.angle;
        }
        return {center: centerPoint, dist: centerDistance, angle: angle};
    }
}