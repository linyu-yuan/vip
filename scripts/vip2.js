// ============================================================
// 原 B站 响应脚本 vip2.js
// 作用：拦截 /x/v2/account/ 的 JSON 响应，替换会员字段
// ============================================================

if ($response.body) {
    try {
        let obj = JSON.parse($response.body);

        // 原 B站 的会员对象，你原样保留
        if (obj && obj.data) {
            obj.data.vip = {
                "type": 2,
                "status": 1,
                "due_date": 4070880000000,
                "vip_pay_type": 0,
                "theme_type": 0,
                "role": 3,
                "avatar_subscript": 1,
                "nickname_color": "#FB7299",
                "label": {
                    "text": "年度大会员",
                    "label_theme": "annual_vip",
                    "text_color": "#ffffff",
                    "bg_style": 1,
                    "bg_color": "#FB7299"
                }
            };
        }

        $done({ body: JSON.stringify(obj) });
    } catch (e) {
        $done({});
    }
} else {
    $done({});
}