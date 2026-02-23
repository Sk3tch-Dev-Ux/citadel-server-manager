// Basic tests for critical API endpoints using supertest
const request = require('supertest');
jest.mock('node-fetch', () => () => Promise.resolve({ json: () => Promise.resolve({}) }));
const app = require('./server');

describe('API Critical Endpoints', () => {
  it('should reject login with invalid credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'fake', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid credentials/);
  });

  it('should enforce password policy on user creation', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', 'Bearer test-admin-token')
      .send({ username: 'testuser', password: 'short', role: 'viewer' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Password does not meet policy/);
  });

  it('should require authentication for backup endpoint', async () => {
    const res = await request(app).get('/api/backup/users');
    expect(res.status).toBe(401);
  });
});
