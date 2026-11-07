import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'VxCgNvLTE.ChA0VDFQRzB5cXZtenRZUmM1EJz4zfkHGAEqEKkX9DzGhkzDor89fU3646Y.Fx5NbRIvSiIbSydEhkQ0FIlZA3MOU6JgaOm_QL1LQeVLe_FYVeh21E7UKYHuXkEH0dGjNUg7jXyJ-byfv6_5qQeZ',
  baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
});

const candidates = [
  'doubao-seed-2-0-lite-260428',
  'doubao-seed-2-0-mini-260428',
];

for (const model of candidates) {
  try {
    const res = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: '你好，用一句话介绍你自己' }],
      max_tokens: 80,
    });
    console.log('✓', model, ':', res.choices[0]?.message?.content);
  } catch (e) {
    console.log('✗', model, ':', e.message?.slice(0, 150));
  }
}
