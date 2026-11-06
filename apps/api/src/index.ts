import app from './server';

const PORT = process.env.API_PORT || 3000;

app.listen(PORT, () => {
  console.log('Server running on http://localhost:' + PORT);
  console.log('Environment:', process.env.NODE_ENV);
});
