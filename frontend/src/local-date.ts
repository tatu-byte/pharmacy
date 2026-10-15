import { Pipe, PipeTransform } from "@angular/core";
const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Johannesburg",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
/** Display and capture share the named business timezone, including history. */
@Pipe({ name: "localDate", standalone: true })
export class LocalDate implements PipeTransform {
  transform(value: string): string {
    return formatter.format(new Date(value));
  }
}
