import fs from 'fs';
import { extractProfileFromText } from './src/parse.ts';

const text = fs.readFileSync('extracted.txt', 'utf-8');
const result = extractProfileFromText(text);

console.log('=== 基本信息 ===');
console.log('姓名:', result.basics?.name);
console.log('职位:', result.basics?.title);
console.log('邮箱:', result.basics?.email);
console.log('电话:', result.basics?.phone);
console.log('简介:', result.summary?.slice(0, 80));
console.log('');
console.log('=== 工作经历 (' + result.experiences?.length + ' 条) ===');
result.experiences?.forEach(e => console.log(`  ${e.company} | ${e.role} | ${e.start}-${e.end || '至今'} (${e.highlights.length} 亮点)`));
console.log('');
console.log('=== 项目 (' + result.projects?.length + ' 个) ===');
result.projects?.forEach(p => console.log(`  ${p.name} [${p.stack.join('/')}]`));
console.log('');
console.log('=== 技能 (' + result.skills?.length + ' 组) ===');
result.skills?.forEach(g => console.log(`  ${g.group}: ${g.items.map(i => i.name).join(', ')}`));
console.log('');
console.log('=== 教育 (' + result.education?.length + ' 条) ===');
result.education?.forEach(e => console.log(`  ${e.school} | ${e.major}`));
