const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 8080;

// 讯飞星辰 API 配置
const XUNFEI_CONFIG = {
    appId: process.env.XUNFEI_APP_ID || '',
    apiKey: process.env.XUNFEI_API_KEY || '',
    apiSecret: process.env.XUNFEI_API_SECRET || '',
    // 星辰大模型 API 地址
    host: 'maas-api.cn-huabei-1.xf-yun.com',
    path: '/v1/chat/completions'
};

// 中间件
app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 数据存储路径
const DATA_DIR = path.join(__dirname, 'data');
const FAVORITES_FILE = path.join(DATA_DIR, 'favorites.json');
const NOTES_FILE = path.join(DATA_DIR, 'notes.json');
const RATINGS_FILE = path.join(DATA_DIR, 'ratings.json');
const CASES_FILE = path.join(DATA_DIR, 'cases.json');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 加载技能数据
let skillsData = null;

function loadSkills() {
    if (!skillsData) {
        const dataPath = path.join(DATA_DIR, 'skills.json');
        skillsData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    }
    return skillsData;
}

// 加载收藏
function loadFavorites() {
    try {
        if (fs.existsSync(FAVORITES_FILE)) {
            return JSON.parse(fs.readFileSync(FAVORITES_FILE, 'utf-8'));
        }
    } catch (e) {}
    return {};
}

function saveFavorites(data) {
    fs.writeFileSync(FAVORITES_FILE, JSON.stringify(data, null, 2));
}

// 加载笔记
function loadNotes() {
    try {
        if (fs.existsSync(NOTES_FILE)) {
            return JSON.parse(fs.readFileSync(NOTES_FILE, 'utf-8'));
        }
    } catch (e) {}
    return {};
}

function saveNotes(data) {
    fs.writeFileSync(NOTES_FILE, JSON.stringify(data, null, 2));
}

// 加载评分
function loadRatings() {
    try {
        if (fs.existsSync(RATINGS_FILE)) {
            return JSON.parse(fs.readFileSync(RATINGS_FILE, 'utf-8'));
        }
    } catch (e) {}
    return {};
}

function saveRatings(data) {
    fs.writeFileSync(RATINGS_FILE, JSON.stringify(data, null, 2));
}

// 加载案例
function loadCases() {
    try {
        if (fs.existsSync(CASES_FILE)) {
            return JSON.parse(fs.readFileSync(CASES_FILE, 'utf-8'));
        }
    } catch (e) {}
    return {};
}

function saveCases(data) {
    fs.writeFileSync(CASES_FILE, JSON.stringify(data, null, 2));
}

// ==================== 讯飞星辰 API 调用 ====================

// 生成讯飞 API 鉴权签名
function generateXunfeiAuth() {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signatureOrigin = `host: ${XUNFEI_CONFIG.host}\ndate: ${timestamp}\nGET ${XUNFEI_CONFIG.path} HTTP/1.1`;
    
    const hmacSha256 = crypto.createHmac('sha256', XUNFEI_CONFIG.apiSecret);
    hmacSha256.update(signatureOrigin);
    const signature = hmacSha256.digest('base64');
    
    const authorizationOrigin = `api_key="${XUNFEI_CONFIG.apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
    const authorization = Buffer.from(authorizationOrigin).toString('base64');
    
    return {
        authorization,
        date: timestamp,
        host: XUNFEI_CONFIG.host
    };
}

// 调用讯飞星辰大模型
async function callXunfeiLLM(messages, options = {}) {
    const { model = 'xDeepV3', temperature = 0.7, maxTokens = 2048 } = options;
    
    return new Promise((resolve, reject) => {
        const requestBody = JSON.stringify({
            model,
            messages,
            temperature,
            max_tokens: maxTokens,
            stream: false
        });
        
        const auth = generateXunfeiAuth();
        
        const requestOptions = {
            hostname: XUNFEI_CONFIG.host,
            port: 443,
            path: `${XUNFEI_CONFIG.path}?authorization=${auth.authorization}&date=${encodeURIComponent(auth.date)}&host=${auth.host}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(requestBody)
            }
        };
        
        const req = https.request(requestOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    if (result.choices && result.choices[0]) {
                        resolve({
                            success: true,
                            content: result.choices[0].message.content,
                            usage: result.usage
                        });
                    } else if (result.error) {
                        reject(new Error(result.error.message || 'API Error'));
                    } else {
                        reject(new Error('Invalid response format'));
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });
        
        req.on('error', reject);
        req.write(requestBody);
        req.end();
    });
}

// 备用：简单的关键词匹配回答
function getFallbackAnswer(question, skills) {
    const q = question.toLowerCase();
    
    const qaRules = [
        {
            patterns: ['怎么开始', '如何使用', '新手', '入门', '怎么用', '怎么学'],
            answer: '建议从热门技能开始探索，点击技能卡片查看详情，然后查看关联技能来发现更多。每个技能都有详细的使用说明和案例分享。',
            skills: skills.sort((a, b) => b.usage - a.usage).slice(0, 3)
        },
        {
            patterns: ['ai', '人工智能', 'gpt', 'chatgpt', '大模型', '对话'],
            answer: '我们有很多AI相关技能，从对话生成到智能助手，可以满足各种场景需求。推荐从ChatGPT API开始学习。',
            skills: skills.filter(s => s.tags.includes('AI') || s.category === 'ai').slice(0, 5)
        },
        {
            patterns: ['客服', '机器人', '聊天', '自动回复'],
            answer: '搭建智能客服系统需要多个技能配合。建议先了解AI对话能力，再学习自动化流程，最后整合企业通讯工具。',
            skills: skills.filter(s => s.tags.includes('AI') || s.tags.includes('自动化') || s.tags.includes('企业微信')).slice(0, 5)
        },
        {
            patterns: ['自动化', '效率', '工作流', '批量'],
            answer: '自动化技能可以帮你节省大量时间，推荐从这些热门自动化技能开始。掌握后可以大幅提升工作效率。',
            skills: skills.filter(s => s.tags.includes('自动化') || s.category === 'automation').slice(0, 5)
        },
        {
            patterns: ['文档', '写作', '内容', '文章'],
            answer: '内容创作技能可以帮助你快速生成高质量内容，提升写作效率。飞书文档技能特别适合团队协作。',
            skills: skills.filter(s => s.category === 'content' || s.tags.includes('文档') || s.tags.includes('飞书')).slice(0, 5)
        },
        {
            patterns: ['数据', '分析', '可视化', '报表', '统计'],
            answer: '数据分析技能可以帮助你从数据中发现洞察，做出更好的决策。推荐从数据可视化开始学习。',
            skills: skills.filter(s => s.category === 'data' || s.tags.includes('数据')).slice(0, 5)
        },
        {
            patterns: ['营销', '推广', '微博', '增长', '获客'],
            answer: '营销增长技能可以帮助你快速触达目标用户，提升品牌影响力。微博热搜和内容营销是不错的起点。',
            skills: skills.filter(s => s.category === 'marketing' || s.tags.includes('营销') || s.tags.includes('微博')).slice(0, 5)
        },
        {
            patterns: ['飞书', '办公', '协作'],
            answer: '飞书技能可以帮助团队高效协作，包括文档管理、日程安排、会议组织等功能。',
            skills: skills.filter(s => s.tags.includes('飞书') || s.category === 'productivity').slice(0, 5)
        },
        {
            patterns: ['企业微信', '会议', '日程', '通知'],
            answer: '企业微信技能适合企业内部沟通和协作，包括会议管理、日程提醒、消息通知等功能。',
            skills: skills.filter(s => s.tags.includes('企业微信') || s.category === 'productivity').slice(0, 5)
        },
        {
            patterns: ['推荐', '建议', '哪个好', '选择'],
            answer: '根据热门程度和使用场景，我为你推荐以下技能。点击查看详情了解更多。',
            skills: skills.sort((a, b) => b.usage - a.usage).slice(0, 5)
        }
    ];
    
    for (const rule of qaRules) {
        if (rule.patterns.some(p => q.includes(p))) {
            return {
                answer: rule.answer,
                skills: rule.skills
            };
        }
    }
    
    // 默认推荐
    return {
        answer: '我理解你的问题。让我为你推荐一些热门技能，或者你可以告诉我更具体的需求，我会给出更精准的建议。',
        skills: skills.sort((a, b) => b.usage - a.usage).slice(0, 3)
    };
}

// ==================== 技能 API ====================

// API: 获取所有技能
app.get('/api/skills', (req, res) => {
    try {
        const data = loadSkills();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: 获取单个技能（含评分、案例统计）
app.get('/api/skills/:id', (req, res) => {
    try {
        const data = loadSkills();
        const skill = data.skills.find(s => s.id === parseInt(req.params.id));
        if (!skill) {
            return res.status(404).json({ error: 'Skill not found' });
        }
        
        const ratings = loadRatings();
        const skillRatings = ratings[req.params.id] || [];
        const avgRating = skillRatings.length > 0 
            ? (skillRatings.reduce((sum, r) => sum + r.rating, 0) / skillRatings.length).toFixed(1)
            : 0;
        
        const cases = loadCases();
        const skillCases = cases[req.params.id] || [];
        
        const relatedSkills = skill.related
            .map(id => data.skills.find(s => s.id === id))
            .filter(Boolean);
        
        res.json({ 
            ...skill, 
            relatedSkills,
            stats: {
                avgRating,
                ratingCount: skillRatings.length,
                caseCount: skillCases.length
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: 搜索技能
app.get('/api/search', (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.json([]);
        
        const data = loadSkills();
        const query = q.toLowerCase();
        
        const results = data.skills.filter(skill => {
            return skill.title.toLowerCase().includes(query) ||
                   skill.name.toLowerCase().includes(query) ||
                   skill.desc.toLowerCase().includes(query) ||
                   skill.tags.some(t => t.toLowerCase().includes(query));
        });
        
        results.sort((a, b) => {
            let scoreA = 0, scoreB = 0;
            if (a.title.toLowerCase() === query) scoreA += 100;
            if (b.title.toLowerCase() === query) scoreB += 100;
            if (a.title.toLowerCase().includes(query)) scoreA += 50;
            if (b.title.toLowerCase().includes(query)) scoreB += 50;
            if (a.name.toLowerCase().includes(query)) scoreA += 40;
            if (b.name.toLowerCase().includes(query)) scoreB += 40;
            a.tags.forEach(t => {
                if (t.toLowerCase() === query) scoreA += 30;
                else if (t.toLowerCase().includes(query)) scoreA += 15;
            });
            b.tags.forEach(t => {
                if (t.toLowerCase() === query) scoreB += 30;
                else if (t.toLowerCase().includes(query)) scoreB += 15;
            });
            if (a.desc.toLowerCase().includes(query)) scoreA += 10;
            if (b.desc.toLowerCase().includes(query)) scoreB += 10;
            return scoreB - scoreA;
        });
        
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== 智能推荐 API ====================

// API: 智能推荐 - 根据目标推荐技能路径
app.post('/api/recommend', async (req, res) => {
    try {
        const { goal, context } = req.body;
        if (!goal) {
            return res.status(400).json({ error: 'Goal is required' });
        }

        const data = loadSkills();
        const goalLower = goal.toLowerCase();
        
        // 关键词匹配规则
        const keywordRules = [
            { keywords: ['ai', '智能', 'gpt', 'chatgpt', '对话', '人工智能'], categories: ['ai'], tags: ['AI', 'ChatGPT', '模型'], path: 'AI智能开发' },
            { keywords: ['客服', '机器人', '聊天', '自动回复'], categories: ['ai', 'automation'], tags: ['聊天', '机器人', '自动化'], path: '智能客服系统' },
            { keywords: ['文档', '飞书', '协作', '办公'], categories: ['productivity'], tags: ['文档', '飞书', '协作'], path: '智能办公协作' },
            { keywords: ['企业微信', '会议', '日程', '通知'], categories: ['productivity'], tags: ['企业微信', '会议', '日程'], path: '企业数字化' },
            { keywords: ['数据', '分析', '可视化', '报表', '统计'], categories: ['data'], tags: ['数据', '分析', '可视化'], path: '数据分析应用' },
            { keywords: ['营销', '推广', '微博', '增长', '获客'], categories: ['marketing'], tags: ['营销', '微博', '社交'], path: '营销增长' },
            { keywords: ['翻译', '多语言', '国际化'], categories: ['translation'], tags: ['翻译'], path: '多语言翻译' },
            { keywords: ['自动化', '工作流', '效率', '批量'], categories: ['automation'], tags: ['自动化', '效率'], path: '自动化工作流' },
            { keywords: ['搜索', '查找', '发现', '检索'], categories: ['search'], tags: ['搜索'], path: '智能搜索' },
            { keywords: ['开发', '代码', '编程', '网站', '应用'], categories: ['dev'], tags: ['开发', '代码'], path: '软件开发' },
            { keywords: ['设计', '图片', '图像', 'ui', '视觉'], categories: ['design'], tags: ['设计', '图像'], path: '设计创意' },
            { keywords: ['内容', '写作', '创作', '文案', '文章'], categories: ['content'], tags: ['内容', '写作'], path: '内容创作' }
        ];
        
        // 匹配规则
        let matchedRules = [];
        keywordRules.forEach(rule => {
            const matchCount = rule.keywords.filter(k => goalLower.includes(k)).length;
            if (matchCount > 0) {
                matchedRules.push({ ...rule, matchCount });
            }
        });
        
        matchedRules.sort((a, b) => b.matchCount - a.matchCount);
        
        // 路径主题
        const pathTheme = matchedRules[0]?.path || '技能学习路径';
        
        // 推荐技能
        let recommendations = [];
        matchedRules.slice(0, 3).forEach(rule => {
            const matches = data.skills.filter(skill => {
                const categoryMatch = rule.categories.includes(skill.category);
                const tagMatch = skill.tags.some(t => rule.tags.includes(t));
                return categoryMatch || tagMatch;
            });
            recommendations.push(...matches);
        });
        
        // 去重并排序
        const seen = new Set();
        recommendations = recommendations.filter(s => {
            if (seen.has(s.id)) return false;
            seen.add(s.id);
            return true;
        }).sort((a, b) => b.usage - a.usage).slice(0, 6);
        
        // 获取评分数据
        const ratings = loadRatings();
        const cases = loadCases();
        
        // 构建学习路径
        const path = recommendations.map((skill, index) => {
            const skillRatings = ratings[skill.id] || [];
            const avgRating = skillRatings.length > 0 
                ? (skillRatings.reduce((sum, r) => sum + r.rating, 0) / skillRatings.length).toFixed(1)
                : 0;
            const caseCount = (cases[skill.id] || []).length;
            
            const steps = [
                { reason: '核心基础，从这里开始', time: '2-3小时', difficulty: '入门' },
                { reason: '扩展能力，增强核心功能', time: '1-2小时', difficulty: '进阶' },
                { reason: '工具集成，打通数据流程', time: '2-3小时', difficulty: '中级' },
                { reason: '优化体验，提升使用效果', time: '1-2小时', difficulty: '进阶' },
                { reason: '深度定制，满足特殊需求', time: '3-4小时', difficulty: '高级' },
                { reason: '实战应用，巩固所学知识', time: '2-3小时', difficulty: '实践' }
            ];
            
            return {
                step: index + 1,
                skill: {
                    id: skill.id,
                    title: skill.title,
                    name: skill.name,
                    desc: skill.desc,
                    category: skill.category,
                    tags: skill.tags
                },
                reason: steps[index].reason,
                estimatedTime: steps[index].time,
                difficulty: steps[index].difficulty,
                avgRating,
                ratingCount: skillRatings.length,
                caseCount
            };
        });
        
        // 生成建议
        const suggestions = [
            `📌 建议从「${path[0]?.skill.title}」开始，这是实现你目标的核心技能`,
            path.length > 2 ? `📌 接着学习「${path[1].skill.title}」和「${path[2].skill.title}」来扩展功能` : '',
            '📌 每个技能完成后查看关联技能，可以发现更多可能性',
            '📌 收藏感兴趣的技能，方便后续快速访问',
            '💡 查看其他用户的使用案例，获得实战灵感'
        ].filter(Boolean);
        
        res.json({
            goal,
            pathTheme,
            path,
            suggestions,
            totalSteps: path.length,
            estimatedTotalTime: `${path.reduce((sum, p) => {
                const t = parseInt(p.estimatedTime);
                return sum + (isNaN(t) ? 0 : t);
            }, 0)}小时`,
            createdAt: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: 导出学习路径
app.post('/api/export-path', (req, res) => {
    try {
        const { pathData, format } = req.body;
        
        if (!pathData || !pathData.path) {
            return res.status(400).json({ error: 'Path data is required' });
        }
        
        const { goal, pathTheme, path, suggestions } = pathData;
        
        let content = '';
        let filename = `学习路径_${new Date().toISOString().slice(0,10)}`;
        let mimeType = 'text/plain';
        
        if (format === 'markdown' || format === 'md') {
            content = `# ${pathTheme || '技能学习路径'}

> 目标：${goal}
> 生成时间：${new Date().toLocaleString('zh-CN')}

## 📚 学习路径

${path.map((step, i) => `
### ${i + 1}. ${step.skill.title}

- **难度**: ${step.difficulty}
- **预计时间**: ${step.estimatedTime}
- **评分**: ${step.avgRating} ⭐ (${step.ratingCount} 人评价)
- **案例**: ${step.caseCount} 个

${step.reason}

**标签**: ${step.skill.tags.join('、')}
`).join('\n')}

## 💡 学习建议

${suggestions.map(s => `- ${s}`).join('\n')}

---

*由 Skillverse 智能生成*
`;
            filename += '.md';
            mimeType = 'text/markdown';
        } else if (format === 'json') {
            content = JSON.stringify(pathData, null, 2);
            filename += '.json';
            mimeType = 'application/json';
        } else {
            content = `${pathTheme || '技能学习路径'}
目标：${goal}
生成时间：${new Date().toLocaleString('zh-CN')}

【学习路径】

${path.map((step, i) => `${i + 1}. ${step.skill.title}
   难度：${step.difficulty}
   时间：${step.estimatedTime}
   说明：${step.reason}
`).join('\n')}

【学习建议】
${suggestions.map(s => '• ' + s).join('\n')}
`;
            filename += '.txt';
        }
        
        res.json({
            success: true,
            content,
            filename,
            mimeType
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: 智能问答 - 接入讯飞星辰大模型
app.post('/api/qa', async (req, res) => {
    try {
        const { question, history } = req.body;
        if (!question) {
            return res.status(400).json({ error: 'Question is required' });
        }

        const data = loadSkills();
        const skills = data.skills;
        
        // 检查是否配置了讯飞 API
        if (!XUNFEI_CONFIG.apiKey || !XUNFEI_CONFIG.apiSecret) {
            console.log('讯飞 API 未配置，使用备用回答');
            const fallback = getFallbackAnswer(question, skills);
            return res.json({
                question,
                answer: fallback.answer,
                relatedSkills: fallback.skills,
                followUp: '还有其他问题吗？',
                source: 'fallback'
            });
        }
        
        // 构建技能知识库摘要
        const skillSummary = skills.slice(0, 30).map(s => 
            `- ${s.title}: ${s.desc.slice(0, 50)}... (分类: ${s.category}, 标签: ${s.tags.join(',')})`
        ).join('\n');
        
        // 构建对话消息
        const messages = [
            {
                role: 'system',
                content: `你是 Skillverse 技能宇宙的智能助手，帮助用户发现和选择适合的技能。

你的职责：
1. 理解用户的目标和需求
2. 从技能库中推荐合适的技能
3. 解释为什么推荐这些技能
4. 给出学习路径建议

技能库概览：
${skillSummary}

回答要求：
- 简洁明了，直接回答用户问题
- 推荐技能时说明原因
- 给出实用的学习建议
- 如果用户问题不明确，引导他们描述具体需求`
            }
        ];
        
        // 添加历史对话
        if (history && history.length > 0) {
            history.forEach(h => {
                messages.push({ role: 'user', content: h.question });
                messages.push({ role: 'assistant', content: h.answer });
            });
        }
        
        // 添加当前问题
        messages.push({ role: 'user', content: question });
        
        try {
            // 调用讯飞星辰 API
            const result = await callXunfeiLLM(messages, {
                model: 'xDeepV3',
                temperature: 0.7,
                maxTokens: 1024
            });
            
            // 匹配相关技能
            const questionLower = question.toLowerCase();
            const relatedSkills = skills.filter(skill => {
                return skill.title.toLowerCase().includes(questionLower) ||
                       skill.tags.some(t => questionLower.includes(t.toLowerCase())) ||
                       skill.desc.toLowerCase().includes(questionLower);
            }).slice(0, 5);
            
            res.json({
                question,
                answer: result.content,
                relatedSkills: relatedSkills.length > 0 ? relatedSkills : skills.sort((a, b) => b.usage - a.usage).slice(0, 3),
                followUp: '还有其他问题吗？我可以继续帮你推荐技能。',
                source: 'xunfei'
            });
            
        } catch (apiError) {
            console.error('讯飞 API 调用失败:', apiError.message);
            
            // 使用备用回答
            const fallback = getFallbackAnswer(question, skills);
            res.json({
                question,
                answer: fallback.answer,
                relatedSkills: fallback.skills,
                followUp: '还有其他问题吗？',
                source: 'fallback',
                error: apiError.message
            });
        }
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== 图谱 API ====================

app.get('/api/graph', (req, res) => {
    try {
        const data = loadSkills();
        const limit = parseInt(req.query.limit) || 100;
        const category = req.query.category;
        const search = req.query.search;
        
        let skills = data.skills;
        if (category) {
            skills = skills.filter(s => s.category === category);
        }
        if (search) {
            const searchLower = search.toLowerCase();
            skills = skills.filter(s => 
                s.title.toLowerCase().includes(searchLower) ||
                s.name.toLowerCase().includes(searchLower) ||
                s.tags.some(t => t.toLowerCase().includes(searchLower))
            );
        }
        
        const topSkills = skills.sort((a, b) => b.usage - a.usage).slice(0, limit);
        
        const nodes = topSkills.map(s => ({
            id: s.id,
            name: s.title,
            category: s.category,
            usage: s.usage,
            tags: s.tags
        }));
        
        const links = [];
        topSkills.forEach(skill => {
            skill.related.forEach(rid => {
                const target = nodes.find(n => n.id === rid);
                if (target && skill.id < rid) {
                    links.push({
                        source: skill.id,
                        target: rid,
                        weight: 1
                    });
                }
            });
        });
        
        res.json({ nodes, links });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== 收藏 API ====================

app.get('/api/favorites', (req, res) => {
    res.json(loadFavorites());
});

app.post('/api/favorites', (req, res) => {
    try {
        const { userId, skillId } = req.body;
        const favorites = loadFavorites();
        
        if (!favorites[userId]) {
            favorites[userId] = [];
        }
        
        if (!favorites[userId].includes(skillId)) {
            favorites[userId].push(skillId);
            saveFavorites(favorites);
        }
        
        res.json({ success: true, favorites: favorites[userId] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/favorites', (req, res) => {
    try {
        const { userId, skillId } = req.body;
        const favorites = loadFavorites();
        
        if (favorites[userId]) {
            favorites[userId] = favorites[userId].filter(id => id !== skillId);
            saveFavorites(favorites);
        }
        
        res.json({ success: true, favorites: favorites[userId] || [] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== 笔记 API ====================

app.get('/api/notes/:skillId', (req, res) => {
    try {
        const notes = loadNotes();
        res.json(notes[req.params.skillId] || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/notes', (req, res) => {
    try {
        const { skillId, content, userId } = req.body;
        const notes = loadNotes();
        
        if (!notes[skillId]) {
            notes[skillId] = [];
        }
        
        const note = {
            id: Date.now(),
            content,
            userId: userId || 'default',
            createdAt: new Date().toISOString()
        };
        
        notes[skillId].push(note);
        saveNotes(notes);
        
        res.json({ success: true, note });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/notes/:skillId/:noteId', (req, res) => {
    try {
        const { skillId, noteId } = req.params;
        const notes = loadNotes();
        
        if (notes[skillId]) {
            notes[skillId] = notes[skillId].filter(n => n.id !== parseInt(noteId));
            saveNotes(notes);
        }
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== 评分 API ====================

app.get('/api/ratings/:skillId', (req, res) => {
    try {
        const ratings = loadRatings();
        const skillRatings = ratings[req.params.skillId] || [];
        
        const avgRating = skillRatings.length > 0 
            ? (skillRatings.reduce((sum, r) => sum + r.rating, 0) / skillRatings.length).toFixed(1)
            : 0;
        
        res.json({
            ratings: skillRatings,
            avgRating,
            count: skillRatings.length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/ratings', (req, res) => {
    try {
        const { skillId, rating, review, userId } = req.body;
        
        if (!skillId || !rating || rating < 1 || rating > 5) {
            return res.status(400).json({ error: 'Invalid rating data' });
        }
        
        const ratings = loadRatings();
        
        if (!ratings[skillId]) {
            ratings[skillId] = [];
        }
        
        const existingIndex = ratings[skillId].findIndex(r => r.userId === userId);
        
        const ratingData = {
            id: Date.now(),
            userId: userId || 'default',
            rating: parseInt(rating),
            review: review || '',
            createdAt: new Date().toISOString()
        };
        
        if (existingIndex > -1) {
            ratings[skillId][existingIndex] = ratingData;
        } else {
            ratings[skillId].push(ratingData);
        }
        
        saveRatings(ratings);
        
        const avgRating = (ratings[skillId].reduce((sum, r) => sum + r.rating, 0) / ratings[skillId].length).toFixed(1);
        
        res.json({ 
            success: true, 
            rating: ratingData,
            avgRating,
            count: ratings[skillId].length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== 使用案例 API ====================

app.get('/api/cases/:skillId', (req, res) => {
    try {
        const cases = loadCases();
        const skillCases = cases[req.params.skillId] || [];
        skillCases.sort((a, b) => (b.likes || 0) - (a.likes || 0));
        res.json(skillCases);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/cases', (req, res) => {
    try {
        const { skillId, title, content, tags, userId, userName } = req.body;
        
        if (!skillId || !title || !content) {
            return res.status(400).json({ error: 'Title and content are required' });
        }
        
        const cases = loadCases();
        
        if (!cases[skillId]) {
            cases[skillId] = [];
        }
        
        const caseData = {
            id: Date.now(),
            skillId,
            userId: userId || 'default',
            userName: userName || '匿名用户',
            title,
            content,
            tags: tags || [],
            likes: 0,
            likedBy: [],
            createdAt: new Date().toISOString()
        };
        
        cases[skillId].push(caseData);
        saveCases(cases);
        
        res.json({ success: true, case: caseData });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/cases/:skillId/:caseId/like', (req, res) => {
    try {
        const { skillId, caseId } = req.params;
        const { userId } = req.body;
        
        const cases = loadCases();
        
        if (cases[skillId]) {
            const caseItem = cases[skillId].find(c => c.id === parseInt(caseId));
            if (caseItem) {
                if (!caseItem.likedBy) caseItem.likedBy = [];
                
                const hasLiked = caseItem.likedBy.includes(userId);
                
                if (hasLiked) {
                    caseItem.likedBy = caseItem.likedBy.filter(id => id !== userId);
                    caseItem.likes = Math.max(0, (caseItem.likes || 0) - 1);
                } else {
                    caseItem.likedBy.push(userId);
                    caseItem.likes = (caseItem.likes || 0) + 1;
                }
                
                saveCases(cases);
                res.json({ success: true, likes: caseItem.likes, hasLiked: !hasLiked });
            } else {
                res.status(404).json({ error: 'Case not found' });
            }
        } else {
            res.status(404).json({ error: 'Skill not found' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/cases/:skillId/:caseId', (req, res) => {
    try {
        const { skillId, caseId } = req.params;
        const { userId } = req.body;
        
        const cases = loadCases();
        
        if (cases[skillId]) {
            const caseIndex = cases[skillId].findIndex(c => c.id === parseInt(caseId) && c.userId === userId);
            
            if (caseIndex > -1) {
                cases[skillId].splice(caseIndex, 1);
                saveCases(cases);
                res.json({ success: true });
            } else {
                res.status(403).json({ error: 'Not authorized' });
            }
        } else {
            res.status(404).json({ error: 'Skill not found' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 启动服务
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════╗
║                                            ║
║   🌌 Skillverse v3.2 is running!           ║
║                                            ║
║   Local:  http://localhost:${PORT}            ║
║                                            ║
║   ✨ 全屏图谱 | 🤖 讯飞星辰智能问答          ║
║   ⭐ 技能评分 | 📝 使用案例 | 📤 导出路径   ║
║                                            ║
╚════════════════════════════════════════════╝
    `);
    
    // 检查讯飞 API 配置
    if (XUNFEI_CONFIG.apiKey && XUNFEI_CONFIG.apiSecret) {
        console.log('✅ 讯飞星辰 API 已配置');
    } else {
        console.log('⚠️  讯飞星辰 API 未配置，请设置环境变量：');
        console.log('   XUNFEI_API_KEY=your_api_key');
        console.log('   XUNFEI_API_SECRET=your_api_secret');
    }
});
