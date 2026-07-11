import { createApp, h } from 'vue';
import { createRouter, createWebHistory, RouterView } from 'vue-router';
import App from './App.vue';
import '../styles.css';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: App },
    { path: '/sessions/:id', component: App },
  ],
});

createApp({ render: () => h(RouterView) }).use(router).mount('#app');
