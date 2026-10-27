'use client';

import { PageTitle } from './shared/page-title';
import { SearchTab } from './search-tab';

export function KnowledgeTestingPage({ kb }: { kb: string }) {
  return (
    <>
      <PageTitle title="Thử truy xuất" description="Xem agent sẽ đọc được những đoạn nào cho một câu hỏi." />
      <SearchTab kb={kb} />
    </>
  );
}
