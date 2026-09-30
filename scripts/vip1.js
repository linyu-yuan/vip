// ============================================================
// 原 B站 请求脚本 vip1.js
// 作用：拦截请求，把 gRPC 二进制数据发给 CF Worker
// ============================================================

const 配置 = {
  // 这里已经换成了你自己的 CF Worker 域名
  网关: "https://vip.helloyuan.eu.org/v1/playviewunite",
  策略: "节点选择", // 【换成你自己的策略组，比如 PROXY】
  超时: 15000
};

// 原 B站 白名单接口
// 【修改这里】换成你自己项目的接口路径
const 白名单 = new Set([
  "grpc.biliapi.net/bilibili.app.playerunite.v1.Player/PlayViewUnite",
  "app.bilibili.com/bilibili.app.playerunite.v1.Player/PlayViewUnite"
]);

// 原 B站 透传头
const 设备头名称 = "x-bili-device-bin"; 
const UID头名称 = "x-bili-uid"; 

// 字节转 Base64
function 字节转Base64(bytes) {
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], has1 = i + 1 < bytes.length, has2 = i + 2 < bytes.length;
    const b1 = has1 ? bytes[i + 1] : 0, b2 = has2 ? bytes[i + 2] : 0;
    out += CHARS[b0 >> 2] + CHARS[((b0 & 0x03) << 4) | (b1 >> 4)] + (has1 ? CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=') + (has2 ? CHARS[b2 & 0x3f] : '=');
  }
  return out;
}

// Base64 转字节
function Base64转字节(input) {
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let s = String(input || '').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const out = [];
  for (let i = 0; i < s.length; i += 4) {
    const c0 = CHARS.indexOf(s[i]), c1 = CHARS.indexOf(s[i + 1]);
    const c2 = s[i + 2] === '=' ? 0 : CHARS.indexOf(s[i + 2]);
    const c3 = s[i + 3] === '=' ? 0 : CHARS.indexOf(s[i + 3]);
    out.push((c0 << 2) | (c1 >> 4));
    if (s[i + 2] !== '=') out.push(((c1 & 0x0f) << 4) | (c2 >> 2));
    if (s[i + 3] !== '=') out.push(((c2 & 0x03) << 6) | c3);
  }
  return new Uint8Array(out);
}

// 主逻辑
async function main() {
  try {
    const req = $request;
    let bodyBytes = req.bodyBytes || req.body;
    if (typeof bodyBytes === 'string') {
      const buf = new Uint8Array(bodyBytes.length);
      for (let i = 0; i < bodyBytes.length; i++) buf[i] = bodyBytes.charCodeAt(i);
      bodyBytes = buf;
    }

    // 取原 B站 的头
    const deviceHeader = req.headers[设备头名称] || "";
    const uid = req.headers[UID头名称] || "123456";

    // 把请求打包发给 CF Worker，由 Worker 去判断白名单
    const payload = {
      version: 1,
      uid: uid,
      target: "grpc.biliapi.net/bilibili.app.playerunite.v1.Player/PlayViewUnite", // 【换成你自己的目标】
      body: 字节转Base64(bodyBytes),
      bodyEncoding: "base64"
    };

    // 发送给 Worker（走你绑定的自定义域名）
    const resp = await new Promise((resolve, reject) => {
      $httpClient.post({
        url: 配置.网关,
        headers: { "Content-Type": "application/json", [设备头名称]: deviceHeader },
        body: JSON.stringify(payload),
        timeout: 配置.超时
      }, (err, resp, data) => {
        if (err) return reject(err);
        resolve({ status: resp.status, body: data });
      });
    });

    const result = JSON.parse(resp.body);
    if (!result.ok) throw new Error(result.message || "Worker 返回错误");

    const finalBytes = Base64转字节(result.body.body);
    $done({
      response: {
        status: result.body.status || 200,
        headers: result.body.headers || {},
        bodyBytes: finalBytes
      }
    });

  } catch (err) {
    console.log("[vip1 报错] " + err.message);
    $done({});
  }
}

main();