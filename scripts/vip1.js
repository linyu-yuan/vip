// ============================================================
// B站 请求脚本 vip1.js（对照原作者脚本修订版）
// 作用：拦截播放接口，把 gRPC 请求体转给 CF Worker，再把结果当作响应返回给 App
// ============================================================

const 配置 = {
  网关: "https://vip.helloyuan.eu.org/v1/playviewunite",
  策略: "",          // 需要让网关请求走某个代理时，填 Surge 里真实的策略组名；留空则不指定
  密钥: "",          // 可选：Worker 设置了 GATEWAY_KEY 就填同样的值
  响应字段: "body",  // 原作者用的是 body（Uint8Array）；若仍不能播放可改成 "bodyBytes" 试试
  补grpcStatus: false // 上游没带 grpc-status 时补 "0"，默认关闭，需要时再开
};

// 允许转发的接口（与 Worker 端一致）
const 白名单 = new Set([
  "grpc.biliapi.net/bilibili.app.playerunite.v1.Player/PlayViewUnite",
  "app.bilibili.com/bilibili.app.playerunite.v1.Player/PlayViewUnite",
  "grpc.biliapi.net/bilibili.app.playurl.v1.PlayURL/PlayView",
  "app.bilibili.com/bilibili.app.playurl.v1.PlayURL/PlayView",
  "grpc.biliapi.net/bilibili.pgc.gateway.player.v2.PlayURL/PlayView",
  "app.bilibili.com/bilibili.pgc.gateway.player.v2.PlayURL/PlayView"
]);

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function 字节转Base64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], has1 = i + 1 < bytes.length, has2 = i + 2 < bytes.length;
    const b1 = has1 ? bytes[i + 1] : 0, b2 = has2 ? bytes[i + 2] : 0;
    out += CHARS[b0 >> 2] + CHARS[((b0 & 0x03) << 4) | (b1 >> 4)] + (has1 ? CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=') + (has2 ? CHARS[b2 & 0x3f] : '=');
  }
  return out;
}

function Base64转字节(input) {
  let s = String(input || '').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]*$/.test(s)) throw new Error("Worker 返回了无效 Base64");
  s = s.padEnd(Math.ceil(s.length / 4) * 4, '=');
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

// 大小写不敏感地取头
function 取头(headers, name) {
  const n = name.toLowerCase();
  for (const k in (headers || {})) {
    if (k.toLowerCase() === n) {
      const v = headers[k];
      return Array.isArray(v) ? v.join(", ") : String(v == null ? "" : v);
    }
  }
  return "";
}

function 取请求体(req) {
  let b = req.bodyBytes || req.body;
  if (b instanceof ArrayBuffer) return new Uint8Array(b);
  if (b && b.buffer instanceof ArrayBuffer && typeof b !== 'string') return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  if (typeof b === 'string' && b.length) {
    const buf = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) {
      const c = b.charCodeAt(i);
      if (c > 0xff) throw new Error("请求 Body 被当作 UTF-8 文本解码，请启用 binary-body-mode");
      buf[i] = c;
    }
    return buf;
  }
  throw new Error("未取得二进制 gRPC Body，请启用 requires-body 与 binary-body-mode");
}

async function main() {
  try {
    const req = $request;

    // 1. 目标接口
    const m = String(req.url || "").match(/^https:\/\/([^/?#]+)(\/[^?#]*)/i);
    if (!m) return $done({});
    const realTarget = m[1].toLowerCase() + m[2];
    if (!白名单.has(realTarget)) return $done({});

    // 2. 用户 mid：真实请求头是 x-bili-mid（原脚本读 x-bili-uid，所以一直拿到默认值）
    const mid = 取头(req.headers, "x-bili-mid").trim();
    if (!/^\d{1,20}$/.test(mid) || /^0+$/.test(mid)) {
      console.log("[vip1] 请求里没有有效的 x-bili-mid，放行原请求");
      return $done({});
    }
    const deviceHeader = 取头(req.headers, "x-bili-device-bin").trim();

    // 3. 发给 Worker
    const bodyBytes = 取请求体(req);
    const payload = {
      version: 1,
      uid: mid,
      target: realTarget,
      body: 字节转Base64(bodyBytes),
      bodyEncoding: "base64"
    };
    const headers = { "Content-Type": "application/json; charset=utf-8", "x-bili-device-bin": deviceHeader };
    if (配置.密钥) headers["x-gateway-key"] = 配置.密钥;
    if (配置.策略) headers["X-Surge-Policy"] = 配置.策略;

    const resp = await new Promise((resolve, reject) => {
      // 与原作者一致：不显式传 timeout，避免单位歧义
      $httpClient.post({ url: 配置.网关, headers: headers, body: JSON.stringify(payload) }, (err, r, data) => {
        if (err) return reject(err);
        resolve({ status: r && r.status, body: data });
      });
    });

    // 4. 解析并校验 Worker 返回
    let result;
    try { result = JSON.parse(resp.body); } catch (_) { throw new Error("Worker 返回非 JSON，HTTP " + resp.status); }
    if (!result || !result.ok || !result.body || typeof result.body !== 'object') {
      throw new Error((result && (result.message || result.error)) || ("Worker 请求失败，HTTP " + resp.status));
    }
    const up = result.body;

    const upHeaders = {};
    for (const k in (up.headers || {})) {
      const v = up.headers[k];
      if (v != null) upHeaders[k] = Array.isArray(v) ? v.join(", ") : String(v);
    }

    // 上游 gRPC 业务错误：不要把空响应交给 App，直接放行原请求
    const gs = 取头(upHeaders, "grpc-status").trim();
    if (gs && gs !== "0") {
      throw new Error("上游 gRPC 错误 " + gs + "：" + (取头(upHeaders, "grpc-message") || "未知"));
    }
    if (up.bodyEncoding && up.bodyEncoding !== "base64") throw new Error("Worker 返回了不支持的编码：" + up.bodyEncoding);

    const finalBytes = Base64转字节(up.body);
    const 声明长度 = Number(result.bodyLength);
    if (isFinite(声明长度) && 声明长度 >= 0 && 声明长度 !== finalBytes.length) {
      throw new Error("响应长度不一致：声明 " + 声明长度 + "，实际 " + finalBytes.length);
    }
    if (finalBytes.length === 0) throw new Error("上游返回了空 Body");

    // 5. 整理响应头：去掉会和 body 不一致的头；没有 content-type 时补 gRPC
    const 丢弃 = ["content-length", "content-encoding", "transfer-encoding", "connection", "keep-alive"];
    const finalHeaders = {};
    for (const k in upHeaders) if (丢弃.indexOf(k.toLowerCase()) === -1) finalHeaders[k] = upHeaders[k];
    if (!取头(finalHeaders, "content-type")) finalHeaders["content-type"] = "application/grpc";
    if (配置.补grpcStatus && !取头(finalHeaders, "grpc-status")) finalHeaders["grpc-status"] = "0";

    console.log("[vip1] mid=" + mid + " target=" + realTarget + " http=" + (up.status || 200) + " grpc-status=" + (gs || "无") + " len=" + finalBytes.length);

    const response = { status: Number(up.status) || 200, headers: finalHeaders };
    response[配置.响应字段 === "bodyBytes" ? "bodyBytes" : "body"] = finalBytes;
    $done({ response: response });

  } catch (err) {
    console.log("[vip1 报错] " + (err && err.message ? err.message : err));
    $done({});
  }
}

main();
