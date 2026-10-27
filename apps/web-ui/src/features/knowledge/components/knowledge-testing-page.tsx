'use client';

import { PageTitle } from './shared/page-title';
import { SearchTab } from './search-tab';

export function KnowledgeTestingPage({ kb }: { kb: string }) {
  return (
    <>
      <PageTitle title="Thử truy xuất" description="Chỉ tìm trong bản agent đang dùng; tài liệu vừa sửa xuất hiện sau khi index xong." />
      <SearchTab kb={kb} />
    </>
  );
}
