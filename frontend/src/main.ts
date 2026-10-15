import { Component } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Search } from './search';
import { Detail } from './detail';
import { Capture } from './capture';
import { Ledger } from './ledger';
@Component({selector:'app-root',standalone:true,imports:[RouterLink,RouterLinkActive,RouterOutlet],template:`
<header><strong>Community Pharmacy</strong><nav aria-label="Main navigation"><a routerLink="/medicines" routerLinkActive="selected">Medicines</a><a routerLink="/capture" routerLinkActive="selected">Capture dispense</a><a routerLink="/ledger" routerLinkActive="selected">Patient ledger</a></nav></header><main><router-outlet /></main>`})
class App {}
bootstrapApplication(App,{providers:[provideHttpClient(),provideRouter([
{path:'medicines',component:Search},{path:'medicines/:code',component:Detail},{path:'capture',component:Capture},{path:'ledger',component:Ledger},{path:'',redirectTo:'medicines',pathMatch:'full'},{path:'**',redirectTo:'medicines'}
])]}).catch(console.error);
