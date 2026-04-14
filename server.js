const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3100;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 加载技能数据
let skillsData = null;
function loadSkillsData() {
    if (!skillsData) {
        const dataPath = path.join(__dirname, 'data', 'skills.json');
        skillsData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    }
    return skillsData;
}

// 获取所有技能
app.get('/api/skills', (req, res) => {
    const data = loadSkillsData();
    const { category, sort, limit } = req.query;
    
    let skills = [...data.skills];
    
    // 按分类过滤
    if (category && category !== 'all') {
        skills = skills.filter(s => s.category === category);
    }
    
    // 排序
    if (sort === 'usage') {
        skills.sort((a, b) => b.usage - a.usage);
    } else if (sort === 'name') {
        skills.sort((a, b) => a.name.localeCompare(b.name));
    }
    
    // 限制数量
    if (limit) {
        skills = skills.slice(0, parseInt(limit));
    }
    
    res.json({ skills, categories: data.categories });
});

// 获取单个技能
app.get('/api/skills/:id', (req, res) => {
    const data = loadSkillsData();
    const skill = data.skills.find(s => s.id === parseInt(req.params.id));
    
    if (!skill) {
        return res.status(404).json({ error: 'Skill not found' });
    }
    
    // 获取关联技能
    const relatedSkills = skill.related.map(id => 
        data.skills.find(s => s.id === id)
    ).filter(Boolean);
    
    res.json({ skill, relatedSkills });
});

// 搜索技能
app.post('/api/search', (req, res) => {
    const data = loadSkillsData();
    const { query } = req.body;
    
    if (!query || !query.trim()) {
        return res.json({ results: [] });
    }
    
    const keywords = query.toLowerCase().split(/\s+/);
    
    const results = data.skills.filter(skill => {
        const searchText = `${skill.name} ${skill.title} ${skill.desc} ${skill.tags.join(' ')}`.toLowerCase();
        return keywords.every(kw => searchText.includes(kw));
    }).map(skill => ({
        ...skill,
        score: keywords.reduce((acc, kw) => {
            let score = 0;
            if (skill.name.toLowerCase().includes(kw)) score += 10;
            if (skill.title.toLowerCase().includes(kw)) score += 8;
            if (skill.desc.toLowerCase().includes(kw)) score += 5;
            if (skill.tags.some(t => t.toLowerCase().includes(kw))) score += 3;
            return acc + score;
        }, 0)
    })).sort((a, b) => b.score - a.score);
    
    res.json({ results: results.slice(0, 50) });
});

// 获取关联图数据
app.get('/api/graph', (req, res) => {
    const data = loadSkillsData();
    const { limit = 100 } = req.query;
    
    // 取使用量最高的技能
    const topSkills = [...data.skills]
        .sort((a, b) => b.usage - a.usage)
        .slice(0, parseInt(limit));
    
    const nodes = topSkills.map(s => ({
        id: s.id,
        name: s.name,
        title: s.title,
        category: s.category,
        usage: s.usage,
        size: Math.max(10, Math.min(50, s.usage / 2000))
    }));
    
    const links = [];
    const nodeIds = new Set(nodes.map(n => n.id));
    
    topSkills.forEach(skill => {
        skill.related.forEach(relId => {
            if (nodeIds.has(relId) && relId > skill.id) {
                links.push({
                    source: skill.id,
                    target: relId
                });
            }
        });
    });
    
    res.json({ nodes, links, categories: data.categories });
});

// 获取排行榜
app.get('/api/ranking', (req, res) => {
    const data = loadSkillsData();
    const { category, limit = 50 } = req.query;
    
    let skills = [...data.skills];
    
    if (category && category !== 'all') {
        skills = skills.filter(s => s.category === category);
    }
    
    skills.sort((a, b) => b.usage - a.usage);
    
    res.json({ 
        ranking: skills.slice(0, parseInt(limit)).map((s, i) => ({
            rank: i + 1,
            ...s
        }))
    });
});

// 获取统计数据
app.get('/api/stats', (req, res) => {
    const data = loadSkillsData();
    
    const stats = {
        totalSkills: data.skills.length,
        totalCategories: data.categories.length,
        totalUsage: data.skills.reduce((sum, s) => sum + s.usage, 0),
        topCategory: data.categories.reduce((top, cat) => {
            const catUsage = data.skills
                .filter(s => s.category === cat.id)
                .reduce((sum, s) => sum + s.usage, 0);
            return catUsage > top.usage ? { ...cat, usage: catUsage } : top;
        }, { usage: 0 }),
        avgUsage: Math.round(data.skills.reduce((sum, s) => sum + s.usage, 0) / data.skills.length),
        topSkills: [...data.skills].sort((a, b) => b.usage - a.usage).slice(0, 10)
    };
    
    res.json(stats);
});

// 首页
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n╔══════════════════════════════════════════════════╗`);
    console.log(`║  🚀 Skill Hub - AI技能知识库                     ║`);
    console.log(`╠══════════════════════════════════════════════════╣`);
    console.log(`║  本地访问: http://localhost:${PORT}                 ║`);
    console.log(`║  技能数量: 300+                                  ║`);
    console.log(`╚══════════════════════════════════════════════════╝\n`);
});
