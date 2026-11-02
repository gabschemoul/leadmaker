import { emailTheme } from './theme';

export function BodyStyle() {
  return (
    <style>
      {`
        body {
          background-color: ${emailTheme.background};
          margin: auto;
          font-family: 'Figtree', 'Segoe UI', Helvetica, Arial, sans-serif;
          color: ${emailTheme.text};
        }
    `}
    </style>
  );
}
