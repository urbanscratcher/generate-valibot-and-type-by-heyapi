import './globals.css';
import 'highlight.js/styles/github.css';

export const metadata = {
  title: 'OpenAPI Snippet',
  description: 'OpenAPI 스펙 기반 코드 생성 뷰어',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
