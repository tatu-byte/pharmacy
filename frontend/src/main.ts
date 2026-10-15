import { Component } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { provideHttpClient } from "@angular/common/http";
import {
  provideRouter,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
  withInMemoryScrolling,
} from "@angular/router";
import { Search } from "./search";
import { Detail } from "./detail";
import { Capture } from "./capture";
import { Ledger } from "./ledger";
@Component({
  selector: "app-root",
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: ` <a class="skip-link" href="#main" (click)="skip($event)"
      >Skip to content</a
    >
    <header class="sidebar">
      <a
        class="brand"
        routerLink="/medicines"
        aria-label="Community Pharmacy home"
        ><span class="brand-mark" aria-hidden="true">+</span
        ><span
          >Community<span class="brand-subtitle">Pharmacy workspace</span></span
        ></a
      >
      <p class="nav-label">WORKSPACE</p>
      <nav aria-label="Main navigation">
        <a
          routerLink="/medicines"
          routerLinkActive="selected"
          ariaCurrentWhenActive="page"
          ><svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="4" y="3" width="16" height="18" rx="3" />
            <path d="M8 8h8M8 12h8M8 16h5" /></svg
          >Medicines</a
        >
        <a
          routerLink="/capture"
          routerLinkActive="selected"
          ariaCurrentWhenActive="page"
          ><svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="4" y="3" width="16" height="18" rx="3" />
            <path d="M8 12h8M12 8v8" /></svg
          >Capture dispense</a
        >
        <a
          routerLink="/ledger"
          routerLinkActive="selected"
          ariaCurrentWhenActive="page"
          ><svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 4h14v17l-3-2-4 2-4-2-3 2zM8 8h8M8 12h8" /></svg
          >Patient ledger</a
        >
      </nav>
      <div class="sidebar-note">
        <span class="status-dot"></span> Local workspace
        <p>All times shown in<br />Africa/Johannesburg</p>
      </div>
    </header>
    <div class="workspace">
      <div class="topbar">
        <span>Formulary & dispensing</span
        ><span class="timezone">Johannesburg time</span>
      </div>
      <main id="main" tabindex="-1"><router-outlet /></main>
      <footer>
        Community Pharmacy <span>Medicine rules. Clear records.</span>
      </footer>
    </div>`,
})
class App {
  skip(event: Event) {
    event.preventDefault();
    document.getElementById("main")?.focus();
  }
}
bootstrapApplication(App, {
  providers: [
    provideHttpClient(),
    provideRouter(
      [
        {
          path: "medicines",
          component: Search,
          title: "Medicines · Community Pharmacy",
        },
        {
          path: "medicines/:code",
          component: Detail,
          title: "Medicine details · Community Pharmacy",
        },
        {
          path: "capture",
          component: Capture,
          title: "Capture dispense · Community Pharmacy",
        },
        {
          path: "ledger",
          component: Ledger,
          title: "Patient ledger · Community Pharmacy",
        },
        { path: "", redirectTo: "medicines", pathMatch: "full" },
        { path: "**", redirectTo: "medicines" },
      ],
      withInMemoryScrolling({ scrollPositionRestoration: "enabled" }),
    ),
  ],
}).catch(console.error);
