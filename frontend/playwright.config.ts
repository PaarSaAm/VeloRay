import {defineConfig} from '@playwright/test'
export default defineConfig({testDir:'tests',fullyParallel:false,workers:1,retries:0,use:{baseURL:process.env.VELORAY_E2E_URL||'http://127.0.0.1:8610',headless:true,viewport:{width:1440,height:1000},screenshot:'only-on-failure',trace:'retain-on-failure'},reporter:[['list']]})
