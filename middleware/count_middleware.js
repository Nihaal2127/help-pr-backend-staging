/**
 * POST /api/getCount: some gateways / older builds duplicate dashboard counts as top-level `records`
 * (same shape as `record`). Strip `records` when both exist so the body only has `record`.
 */
const stripDuplicateRecordsFromGetCountResponse = (req, res, next) => {
    const stripIfNeeded = (payload) => {
        if (
            payload &&
            typeof payload === 'object' &&
            !Array.isArray(payload) &&
            Object.prototype.hasOwnProperty.call(payload, 'record') &&
            Object.prototype.hasOwnProperty.call(payload, 'records')
        ) {
            const { records: _removed, ...rest } = payload;
            return rest;
        }
        return payload;
    };

    const origJson = res.json.bind(res);
    res.json = (payload) => origJson(stripIfNeeded(payload));

    const origSend = res.send.bind(res);
    res.send = function (body) {
        if (typeof body === 'string') {
            const t = body.trim();
            if (t.startsWith('{')) {
                try {
                    const parsed = JSON.parse(t);
                    const fixed = stripIfNeeded(parsed);
                    if (fixed !== parsed) {
                        return origSend(JSON.stringify(fixed));
                    }
                } catch (_) {
                    /* not JSON */
                }
            }
        }
        return origSend(body);
    };

    res.once('finish', () => {
        res.json = origJson;
        res.send = origSend;
    });
    next();
};

module.exports = { stripDuplicateRecordsFromGetCountResponse };
