const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080;

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
        
        // 添加评分统计
        const ratings = loadRatings();
        const skillRatings = ratings[req.params.id] || [];
        const avgRating = skillRatings.length > 0 
            ? (skillRatings.reduce((sum, r) => sum + r.rating, 0) / skillRatings.length).toFixed(1)
            : 0;
        
        // 添加案例统计
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
app.post('/api/recommend', (req, res) => {
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
            // 纯文本
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

// API: 智能问答
app.post('/api/qa', (req, res) => {
    try {
        const { question } = req.body;
        if (!question) {
            return res.status(400).json({ error: 'Question is required' });
        }

        const data = loadSkills();
        const q = question.toLowerCase();
        
        const qaRules = [
            {
                patterns: ['怎么开始', '如何使用', '新手', '入门'],
                answer: '建议从热门技能开始探索，点击技能卡片查看详情，然后查看关联技能来发现更多。',
                skills: data.skills.sort((a, b) => b.usage - a.usage).slice(0, 3)
            },
            {
                patterns: ['ai', '人工智能', 'gpt', 'chatgpt'],
                answer: '我们有很多AI相关技能，从对话生成到图像识别，可以满足各种场景需求。',
                skills: data.skills.filter(s => s.tags.includes('AI') || s.category === 'ai').slice(0, 5)
            },
            {
                patterns: ['自动化', '效率', '工作流'],
                answer: '自动化技能可以帮你节省大量时间，推荐从这些热门自动化技能开始。',
                skills: data.skills.filter(s => s.tags.includes('自动化') || s.category === 'automation').slice(0, 5)
            },
            {
                patterns: ['文档', '写作', '内容'],
                answer: '内容创作技能可以帮助你快速生成高质量内容，提升写作效率。',
                skills: data.skills.filter(s => s.category === 'content' || s.tags.includes('文档')).slice(0, 5)
            },
            {
                patterns: ['数据', '分析', '可视化'],
                answer: '数据分析技能可以帮助你从数据中发现洞察，做出更好的决策。',
                skills: data.skills.filter(s => s.category === 'data' || s.tags.includes('数据')).slice(0, 5)
            }
        ];
        
        let matched = null;
        for (const rule of qaRules) {
            if (rule.patterns.some(p => q.includes(p))) {
                matched = rule;
                break;
            }
        }
        
        if (matched) {
            res.json({
                question,
                answer: matched.answer,
                relatedSkills: matched.skills,
                followUp: '还有其他问题吗？'
            });
        } else {
            const topSkills = data.skills.sort((a, b) => b.usage - a.usage).slice(0, 3);
            res.json({
                question,
                answer: '我理解你的问题。让我为你推荐一些相关技能，或者你可以告诉我更具体的需求。',
                relatedSkills: topSkills,
                followUp: '你具体想实现什么功能？'
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
        const limit = parseInt(req.query.limit) || 80;
        const category = req.query.category;
        
        let skills = data.skills;
        if (category) {
            skills = skills.filter(s => s.category === category);
        }
        
        const topSkills = skills.sort((a, b) => b.usage - a.usage).slice(0, limit);
        
        const nodes = topSkills.map(s => ({
            id: s.id,
            name: s.title,
            category: s.category,
            usage: s.usage
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

// 获取技能评分列表
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

// 提交评分
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
        
        // 检查是否已评分（每个用户每个技能只能评一次）
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

// 获取技能案例列表
app.get('/api/cases/:skillId', (req, res) => {
    try {
        const cases = loadCases();
        const skillCases = cases[req.params.skillId] || [];
        
        // 按点赞数排序
        skillCases.sort((a, b) => (b.likes || 0) - (a.likes || 0));
        
        res.json(skillCases);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 提交使用案例
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

// 点赞案例
app.post('/api/cases/:skillId/:caseId/like', (req, res) => {
    try {
        const { skillId, caseId } = req.params;
        const { userId } = req.body;
        
        const cases = loadCases();
        
        if (cases[skillId]) {
            const caseItem = cases[skillId].find(c => c.id === parseInt(caseId));
            if (caseItem) {
                if (!caseItem.likedBy) {
                    caseItem.likedBy = [];
                }
                
                const hasLiked = caseItem.likedBy.includes(userId);
                
                if (hasLiked) {
                    // 取消点赞
                    caseItem.likedBy = caseItem.likedBy.filter(id => id !== userId);
                    caseItem.likes = Math.max(0, (caseItem.likes || 0) - 1);
                } else {
                    // 点赞
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

// 删除案例
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
                res.status(403).json({ error: 'Not authorized to delete this case' });
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
║   🌌 Skillverse v3.0 is running!           ║
║                                            ║
║   Local:  http://localhost:${PORT}            ║
║                                            ║
║   ✨ 探索技能宇宙，发现无限可能              ║
║   ⭐ 技能评分 | 📝 使用案例 | 📤 导出路径   ║
║                                            ║
╚════════════════════════════════════════════╝
    `);
});
