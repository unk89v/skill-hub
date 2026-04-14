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

// 保存收藏
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

// 保存笔记
function saveNotes(data) {
    fs.writeFileSync(NOTES_FILE, JSON.stringify(data, null, 2));
}

// API: 获取所有技能
app.get('/api/skills', (req, res) => {
    try {
        const data = loadSkills();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: 获取单个技能
app.get('/api/skills/:id', (req, res) => {
    try {
        const data = loadSkills();
        const skill = data.skills.find(s => s.id === parseInt(req.params.id));
        if (!skill) {
            return res.status(404).json({ error: 'Skill not found' });
        }
        const relatedSkills = skill.related
            .map(id => data.skills.find(s => s.id === id))
            .filter(Boolean);
        res.json({ ...skill, relatedSkills });
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
            { keywords: ['ai', '智能', 'gpt', 'chatgpt', '对话'], categories: ['ai'], tags: ['AI', 'ChatGPT', '模型'] },
            { keywords: ['客服', '机器人', '聊天'], categories: ['ai', 'automation'], tags: ['聊天', '机器人', '自动化'] },
            { keywords: ['文档', '飞书', '协作'], categories: ['productivity'], tags: ['文档', '飞书', '协作'] },
            { keywords: ['企业微信', '会议', '日程'], categories: ['productivity'], tags: ['企业微信', '会议', '日程'] },
            { keywords: ['数据', '分析', '可视化'], categories: ['data'], tags: ['数据', '分析', '可视化'] },
            { keywords: ['营销', '推广', '微博'], categories: ['marketing'], tags: ['营销', '微博', '社交'] },
            { keywords: ['翻译', '多语言'], categories: ['translation'], tags: ['翻译'] },
            { keywords: ['自动化', '工作流', '效率'], categories: ['automation'], tags: ['自动化', '效率'] },
            { keywords: ['搜索', '查找', '发现'], categories: ['search'], tags: ['搜索'] },
            { keywords: ['开发', '代码', '编程'], categories: ['dev'], tags: ['开发', '代码'] },
            { keywords: ['设计', '图片', '图像'], categories: ['design'], tags: ['设计', '图像'] },
            { keywords: ['内容', '写作', '创作'], categories: ['content'], tags: ['内容', '写作'] }
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
        }).sort((a, b) => b.usage - a.usage).slice(0, 8);
        
        // 构建学习路径
        const path = recommendations.map((skill, index) => {
            const reasons = [
                '核心技能，从这里开始',
                '扩展能力，增强功能',
                '集成工具，打通流程',
                '优化体验，提升效率',
                '进阶功能，深度定制'
            ];
            return {
                step: index + 1,
                skill,
                reason: reasons[index] || '推荐技能',
                estimatedTime: `${Math.floor(Math.random() * 3) + 1}小时`
            };
        });
        
        // 生成建议
        const suggestions = [
            `建议从「${path[0]?.skill.title}」开始，这是实现你目标的核心技能`,
            path.length > 2 ? `然后学习「${path[1].skill.title}」和「${path[2].skill.title}」来扩展功能` : '',
            '记得查看每个技能的关联技能，可以发现更多可能'
        ].filter(Boolean);
        
        res.json({
            goal,
            path,
            suggestions,
            totalSteps: path.length,
            estimatedTotalTime: path.reduce((sum, p) => sum + parseInt(p.estimatedTime), 0) + '小时'
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
        
        // 预设问答
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
        
        // 匹配规则
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
            // 默认回复
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

// API: 图谱数据
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

// API: 收藏管理
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

// API: 笔记管理
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

// 启动服务
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════╗
║                                            ║
║   🌌 Skillverse is running!                ║
║                                            ║
║   Local:  http://localhost:${PORT}            ║
║                                            ║
║   ✨ 探索技能宇宙，发现无限可能              ║
║                                            ║
╚════════════════════════════════════════════╝
    `);
});
