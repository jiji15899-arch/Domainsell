// Cloudflare Workers - DNS 관리 백엔드

// 환경 변수에서 설정 가져오기
// CLOUDFLARE_API_TOKEN: Cloudflare API 토큰
// CLOUDFLARE_ZONE_ID: DNS 존 ID
// DOMAIN_EXTENSION: 도메인 확장자 (예: your-domain.com)

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
};

// Cloudflare API 호출 함수
async function callCloudflareAPI(endpoint, method, body, env) {
    const url = `https://api.cloudflare.com/v4${endpoint}`;
    
    const options = {
        method: method,
        headers: {
            'Authorization': `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
            'Content-Type': 'application/json'
        }
    };
    
    if (body) {
        options.body = JSON.stringify(body);
    }
    
    const response = await fetch(url, options);
    return await response.json();
}

// DNS 레코드 생성
async function createDNSRecord(domain, target, type, env) {
    const fullDomain = `${domain}.${env.DOMAIN_EXTENSION}`;
    
    // 기존 레코드 확인
    const existingRecords = await callCloudflareAPI(
        `/zones/${env.CLOUDFLARE_ZONE_ID}/dns_records?name=${fullDomain}`,
        'GET',
        null,
        env
    );
    
    // 이미 존재하는 경우
    if (existingRecords.result && existingRecords.result.length > 0) {
        return {
            success: false,
            message: '이미 등록된 도메인입니다.'
        };
    }
    
    // 새 DNS 레코드 생성
    const recordData = {
        type: type,
        name: fullDomain,
        content: target,
        ttl: 3600,
        proxied: false
    };
    
    const result = await callCloudflareAPI(
        `/zones/${env.CLOUDFLARE_ZONE_ID}/dns_records`,
        'POST',
        recordData,
        env
    );
    
    if (result.success) {
        // KV에 도메인 정보 저장 (선택사항)
        if (env.DOMAINS_KV) {
            await env.DOMAINS_KV.put(fullDomain, JSON.stringify({
                domain: fullDomain,
                target: target,
                type: type,
                createdAt: new Date().toISOString()
            }));
        }
        
        return {
            success: true,
            message: '도메인이 성공적으로 등록되었습니다.',
            domain: fullDomain
        };
    } else {
        return {
            success: false,
            message: result.errors?.[0]?.message || '도메인 등록에 실패했습니다.'
        };
    }
}

// 도메인 조회
async function getDomainInfo(domain, env) {
    const fullDomain = `${domain}.${env.DOMAIN_EXTENSION}`;
    
    if (env.DOMAINS_KV) {
        const info = await env.DOMAINS_KV.get(fullDomain);
        if (info) {
            return {
                success: true,
                data: JSON.parse(info)
            };
        }
    }
    
    return {
        success: false,
        message: '도메인을 찾을 수 없습니다.'
    };
}

// 요청 핸들러
async function handleRequest(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // CORS preflight
    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: CORS_HEADERS });
    }
    
    // 도메인 등록
    if (path === '/register' && request.method === 'POST') {
        try {
            const body = await request.json();
            const { domain, target, type } = body;
            
            // 유효성 검사
            if (!domain || !target || !type) {
                return new Response(JSON.stringify({
                    success: false,
                    message: '필수 정보가 누락되었습니다.'
                }), {
                    status: 400,
                    headers: CORS_HEADERS
                });
            }
            
            // 도메인 이름 검증
            const domainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
            if (!domainRegex.test(domain)) {
                return new Response(JSON.stringify({
                    success: false,
                    message: '유효하지 않은 도메인 이름입니다.'
                }), {
                    status: 400,
                    headers: CORS_HEADERS
                });
            }
            
            const result = await createDNSRecord(domain, target, type, env);
            
            return new Response(JSON.stringify(result), {
                status: result.success ? 200 : 400,
                headers: CORS_HEADERS
            });
        } catch (error) {
            return new Response(JSON.stringify({
                success: false,
                message: '서버 오류가 발생했습니다.'
            }), {
                status: 500,
                headers: CORS_HEADERS
            });
        }
    }
    
    // 도메인 조회
    if (path.startsWith('/check/') && request.method === 'GET') {
        const domain = path.split('/')[2];
        const result = await getDomainInfo(domain, env);
        
        return new Response(JSON.stringify(result), {
            status: result.success ? 200 : 404,
            headers: CORS_HEADERS
        });
    }
    
    // 기본 응답
    return new Response(JSON.stringify({
        success: true,
        message: 'Free Domain Service API',
        endpoints: {
            register: 'POST /register',
            check: 'GET /check/:domain'
        }
    }), {
        headers: CORS_HEADERS
    });
}

// Workers 진입점
export default {
    async fetch(request, env, ctx) {
        return handleRequest(request, env);
    }
};
