'use client';

import { PageTitle } from './shared/page-title';
import { SearchTab } from './search-tab';

export function KnowledgeTestingPage({ kb }: { kb: string }) {
  return (
    <>
      <PageTitle title="Thử truy xuất" description="Kiểm tra agent truy xuất được những đoạn nào cho một câu hỏi. Đây không phải thử chat — không sinh câu trả lời AI." />
      <SearchTab kb={kb} />
    </>
  );
}
