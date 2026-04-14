const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080;

// 中间件
app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 加载技能数据
let skillsData = null;

function loadSkills() {
    if (!skillsData) {
        const dataPath = path.join(__dirname, 'data', 'skills.json');
        skillsData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    }
    return skillsData;
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

// API: 获取单个技能详情
app.get('/api/skills/:id', (req, res) => {
    try {
        const data = loadSkills();
        const skill = data.skills.find(s => s.id === parseInt(req.params.id));
        if (!skill) {
            return res.status(404).json({ error: 'Skill not found' });
        }
        
        // 获取关联技能详情
        const relatedSkills = skill.related
            .map(id => data.skills.find(s => s.id === id))
            .filter(Boolean);
        
        res.json({ ...skill, relatedSkills });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: 智能推荐 - 根据目标推荐技能路径
app.post('/api/recommend', (req, res) => {
    try {
        const { goal } = req.body;
        if (!goal) {
            return res.status(400).json({ error: 'Goal is required' });
        }

        const data = loadSkills();
        const goalLower = goal.toLowerCase();
        
        // 关键词匹配
        const keywords = {
            'ai': ['AI', '智能', '模型', 'GPT', 'ChatGPT'],
            '客服': ['聊天', '机器人', '对话', '客服'],
            '文档': ['文档', '飞书', '企业微信', '写作'],
            '数据': ['数据', '分析', '可视化', '表格'],
            '营销': ['营销', '推广', '微博', '社交'],
            '翻译': ['翻译', '多语言', '国际化'],
            '自动化': ['自动化', '效率', '流程'],
            '搜索': ['搜索', '百度', '发现']
        };
        
        // 匹配关键词
        const matchedCategories = [];
        Object.entries(keywords).forEach(([key, words]) => {
            if (goalLower.includes(key) || words.some(w => goalLower.includes(w.toLowerCase()))) {
                matchedCategories.push(key);
            }
        });
        
        // 推荐技能
        const recommendations = data.skills.filter(skill => {
            return matchedCategories.some(cat => 
                skill.tags.some(t => t.toLowerCase().includes(cat)) ||
                skill.desc.toLowerCase().includes(cat)
            );
        }).slice(0, 10);
        
        // 构建学习路径
        const path = recommendations.map((skill, index) => ({
            step: index + 1,
            skill,
            reason: `帮助你实现${matchedCategories[0] || '目标'}相关功能`
        }));
        
        res.json({
            goal,
            matchedCategories,
            path,
            totalSteps: path.length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: 搜索技能
app.get('/api/search', (req, res) => {
    try {
        const { q } = req.query;
        if (!q) {
            return res.json([]);
        }

        const data = loadSkills();
        const query = q.toLowerCase();
        
        const results = data.skills.filter(skill => {
            return skill.title.toLowerCase().includes(query) ||
                   skill.name.toLowerCase().includes(query) ||
                   skill.desc.toLowerCase().includes(query) ||
                   skill.tags.some(t => t.toLowerCase().includes(query));
        });
        
        // 相关性排序
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

// API: 技能关联图谱数据
app.get('/api/graph', (req, res) => {
    try {
        const data = loadSkills();
        const limit = parseInt(req.query.limit) || 60;
        
        // 选择热门技能
        const topSkills = data.skills
            .sort((a, b) => b.usage - a.usage)
            .slice(0, limit);
        
        // 构建节点
        const nodes = topSkills.map(s => ({
            id: s.id,
            name: s.title,
            category: s.category,
            usage: s.usage
        }));
        
        // 构建链接
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

// 启动服务
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════╗
║                                            ║
║   🚀 Skill Hub is running!                 ║
║                                            ║
║   Local:  http://localhost:${PORT}            ║
║                                            ║
║   ✨ Discover Your Superpowers              ║
║                                            ║
╚════════════════════════════════════════════╝
    `);
});
