import { Component, DestroyRef, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { Subscription } from "rxjs";
import { Api, Medicine, Page, violations } from "./api";
@Component({
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: ` <div class="page-heading">
      <div>
        <p class="eyebrow">Medicine catalogue</p>
        <h1>Find a medicine</h1>
        <p class="subtitle">
          Search the formulary, review its rules and capture a dispense.
        </p>
      </div>
      <a class="button" routerLink="/capture"
        >Capture dispense <span aria-hidden="true">+</span></a
      >
    </div>
    <section class="card" aria-label="Medicine catalogue">
      <form class="toolbar" (ngSubmit)="search()">
        <div class="field">
          <label for="query">Name or code</label
          ><input
            id="query"
            name="query"
            [(ngModel)]="query"
            maxlength="100"
            placeholder="Search by medicine name or code"
            autocomplete="off"
          />
        </div>
        <button type="submit">Search</button>
        @if (applied || query) {
          <button type="button" class="secondary" (click)="clear()">
            Clear
          </button>
        }
      </form>
      <div class="card-title">
        <h2>{{ applied ? "Search results" : "All medicines" }}</h2>
        <span>View a medicine to see its rules</span>
      </div>
      @if (loading) {
        <p class="loading" role="status">Loading medicines…</p>
      }
      @if (error) {
        <div class="notice danger inline-notice" role="alert">
          <p>{{ error }}</p>
          <button type="button" class="secondary" (click)="retry()">
            Retry loading
          </button>
        </div>
      }
      @if (!loading && !error && !rows.length) {
        <div class="empty">
          <span class="empty-symbol" aria-hidden="true">⌕</span>
          <h2>
            {{ applied ? "No matching medicines" : "No medicines available" }}
          </h2>
          <p>
            {{
              applied
                ? "Try a shorter name or check the medicine code."
                : "The catalogue is empty. Check again once medicines have been added."
            }}
          </p>
          @if (applied) {
            <button class="secondary" (click)="clear()">
              Show all medicines
            </button>
          }
        </div>
      }
      @if (rows.length) {
        <div
          class="table-wrap"
          tabindex="0"
          role="region"
          aria-label="Medicines, scroll horizontally on smaller screens"
          [attr.aria-busy]="loading"
        >
          <table>
            <caption class="sr-only">
              Medicines on page
              {{
                history.length + 1
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">Medicine</th>
                <th scope="col">Form</th>
                <th scope="col">Strength</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              @for (m of rows; track m.code) {
                <tr>
                  <td>
                    <span class="medicine-name">{{ m.name }}</span
                    ><a class="code" [routerLink]="['/medicines', m.code]">{{
                      m.code
                    }}</a>
                  </td>
                  <td>{{ m.form }}</td>
                  <td class="nowrap">
                    {{ m.strength_value }} {{ m.strength_unit }}
                  </td>
                  <td>
                    <span class="status" [class.inactive]="!m.is_active">{{
                      m.is_active ? "Active" : "Inactive"
                    }}</span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
      <div class="pager">
        <p role="status">
          Page {{ history.length + 1 }} · {{ rows.length }}
          {{ rows.length === 1 ? "medicine" : "medicines" }} shown
        </p>
        <div class="actions">
          <button
            class="secondary"
            (click)="previous()"
            [disabled]="loading || !history.length"
          >
            Previous</button
          ><button
            class="secondary"
            (click)="advance()"
            [disabled]="loading || !next"
          >
            Next
          </button>
        </div>
      </div>
    </section>
    <p class="page-note">
      Inactive medicines remain visible for reference. They cannot be dispensed.
    </p>`,
})
export class Search {
  private api = inject(Api);
  private destroy = inject(DestroyRef);
  private request?: Subscription;
  private failedCursor: string | null = null;
  private failedHistory: (string | null)[] = [];
  query = "";
  applied = "";
  rows: Medicine[] = [];
  next: string | null = null;
  current: string | null = null;
  history: (string | null)[] = [];
  loading = false;
  error = "";
  constructor() {
    this.load(null);
  }
  clear() {
    this.query = "";
    this.search();
  }
  search() {
    this.applied = this.query.trim();
    this.history = [];
    this.rows = [];
    this.next = null;
    this.current = null;
    this.load(null);
  }
  advance() {
    if (this.next) this.load(this.next, [...this.history, this.current]);
  }
  previous() {
    if (this.history.length)
      this.load(this.history.at(-1) ?? null, this.history.slice(0, -1));
  }
  retry() {
    this.load(this.failedCursor, this.failedHistory);
  }
  load(cursor: string | null, history = this.history) {
    this.request?.unsubscribe();
    this.loading = true;
    this.error = "";
    this.failedCursor = cursor;
    this.failedHistory = history;
    this.request = this.api
      .get<Page<Medicine>>("/medicines", { q: this.applied, cursor })
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (p) => {
          this.current = cursor;
          this.history = history;
          this.rows = p.data;
          this.next = p.next_cursor;
          this.loading = false;
        },
        error: (e) => {
          this.error = violations(e)
            .map((v) => v.message)
            .join(" ");
          this.loading = false;
        },
      });
  }
}
