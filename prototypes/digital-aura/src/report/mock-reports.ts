import type { ReportData } from './types';

/**
 * SAMPLE DATA for the report mockup — not produced by the assessment engine. Replace with the
 * result API once the backend exposes majors, scores and reasons. `because` indexes the
 * archetype's strengths in content/<id>.ts.
 */
export const mockReports: Record<string, ReportData> = {
  creator: {
    createdAt: '2026-10-22',
    isDemo: true,
    majors: [
      {
        group: 'Nghệ thuật – Thiết kế',
        name: 'Thiết kế đồ hoạ',
        score: 93,
        because: [0, 1],
        description:
          'Biến ý tưởng thành hình ảnh có chủ đích. Óc sáng tạo và con mắt tinh tế của bạn là nền tảng tốt cho nhận diện thương hiệu, minh hoạ và thiết kế số.',
        blocks: ['H00', 'V00', 'D01'],
        careers: ['Nhà thiết kế thương hiệu', 'Họa sĩ minh hoạ', 'UI designer'],
      },
      {
        group: 'Truyền thông – Sáng tạo',
        name: 'Truyền thông đa phương tiện',
        score: 88,
        because: [0, 2],
        description:
          'Kể câu chuyện bằng video, âm thanh và hình ảnh. Phù hợp với người luôn có ý tưởng mới và thích truyền cảm hứng cho người khác.',
        blocks: ['D01', 'A01', 'C00'],
        careers: ['Nhà sản xuất nội dung', 'Biên tập video', 'Creative planner'],
      },
      {
        group: 'Kiến trúc – Không gian',
        name: 'Kiến trúc',
        score: 81,
        because: [1, 0],
        description:
          'Thiết kế không gian sống vừa đẹp vừa hợp lý. Đòi hỏi sự tinh tế trong chi tiết và khả năng hình dung không gian.',
        blocks: ['V00', 'A01'],
        careers: ['Kiến trúc sư', 'Thiết kế cảnh quan', 'Diễn hoạ kiến trúc'],
      },
    ],
    others: [
      { name: 'Thiết kế nội thất', score: 79 },
      { name: 'Thiết kế thời trang', score: 76 },
      { name: 'Công nghệ điện ảnh', score: 74 },
      { name: 'Marketing', score: 71 },
      { name: 'Quản trị sự kiện', score: 68 },
    ],
  },
  decoder: {
    createdAt: '2026-10-22',
    isDemo: true,
    majors: [
      {
        group: 'Công nghệ thông tin',
        name: 'Khoa học máy tính',
        score: 94,
        because: [0, 2],
        description:
          'Hiểu cách máy tính giải quyết vấn đề, từ thuật toán đến hệ thống. Tư duy logic và sự chính xác của bạn rất hợp với lĩnh vực này.',
        blocks: ['A00', 'A01', 'D07'],
        careers: ['Kỹ sư phần mềm', 'Kỹ sư AI', 'Nhà nghiên cứu'],
      },
      {
        group: 'Toán – Tin ứng dụng',
        name: 'Khoa học dữ liệu',
        score: 89,
        because: [1, 0],
        description:
          'Tìm quy luật ẩn trong dữ liệu để trả lời những câu hỏi thực tế. Hợp với người tò mò, thích đào sâu "vì sao".',
        blocks: ['A00', 'A01', 'D01'],
        careers: ['Nhà khoa học dữ liệu', 'Chuyên viên phân tích', 'Kỹ sư dữ liệu'],
      },
      {
        group: 'Công nghệ thông tin',
        name: 'An toàn thông tin',
        score: 84,
        because: [2, 1],
        description:
          'Phát hiện và vá lỗ hổng trước khi kẻ xấu tìm ra. Cần sự cẩn thận, chính xác và tò mò về cách hệ thống vận hành.',
        blocks: ['A00', 'A01'],
        careers: ['Chuyên gia bảo mật', 'Pentester', 'Kỹ sư hệ thống'],
      },
    ],
    others: [
      { name: 'Kỹ thuật phần mềm', score: 82 },
      { name: 'Toán ứng dụng', score: 78 },
      { name: 'Kỹ thuật điện tử', score: 75 },
      { name: 'Vật lý kỹ thuật', score: 71 },
      { name: 'Kiểm toán', score: 67 },
    ],
  },
  healer: {
    createdAt: '2026-10-22',
    isDemo: true,
    majors: [
      {
        group: 'Khoa học xã hội',
        name: 'Tâm lý học',
        score: 92,
        because: [2, 1],
        description:
          'Tìm hiểu cảm xúc và hành vi con người để giúp họ sống tốt hơn. Sự thấu cảm và điềm tĩnh của bạn là điểm mạnh lớn.',
        blocks: ['C00', 'D01', 'B00'],
        careers: ['Chuyên viên tham vấn', 'Tâm lý học đường', 'Nhà nghiên cứu hành vi'],
      },
      {
        group: 'Sức khoẻ',
        name: 'Điều dưỡng',
        score: 87,
        because: [0, 1],
        description:
          'Chăm sóc người bệnh trực tiếp và đồng hành cùng họ trong quá trình hồi phục. Cần sự bình tĩnh và mong muốn chữa lành.',
        blocks: ['B00', 'A00'],
        careers: ['Điều dưỡng viên', 'Điều dưỡng cộng đồng', 'Quản lý điều dưỡng'],
      },
      {
        group: 'Cộng đồng',
        name: 'Công tác xã hội',
        score: 83,
        because: [2, 0],
        description:
          'Hỗ trợ cá nhân và cộng đồng yếu thế vượt qua khó khăn. Phù hợp với người muốn tạo thay đổi tích cực quanh mình.',
        blocks: ['C00', 'D01', 'D14'],
        careers: ['Nhân viên công tác xã hội', 'Điều phối dự án cộng đồng', 'Tư vấn viên'],
      },
    ],
    others: [
      { name: 'Kỹ thuật phục hồi chức năng', score: 80 },
      { name: 'Dinh dưỡng', score: 77 },
      { name: 'Giáo dục mầm non', score: 74 },
      { name: 'Y học cổ truyền', score: 72 },
      { name: 'Giáo dục đặc biệt', score: 70 },
    ],
  },
  leader: {
    createdAt: '2026-10-22',
    isDemo: true,
    majors: [
      {
        group: 'Quản trị – Nhân lực',
        name: 'Quản trị nhân lực',
        score: 93,
        because: [2, 0],
        description:
          'Xây dựng đội ngũ, phát triển con người và văn hoá tổ chức. Bạn biết lắng nghe và dẫn dắt — đúng chất của người làm nhân sự.',
        blocks: ['D01', 'A01', 'C00'],
        careers: ['Chuyên viên nhân sự', 'Đào tạo & phát triển', 'HR Business Partner'],
      },
      {
        group: 'Kinh doanh – Quản lý',
        name: 'Quản trị kinh doanh',
        score: 88,
        because: [2, 1],
        description:
          'Định hướng chiến lược và điều phối nguồn lực để tổ chức phát triển. Góc nhìn rộng giúp bạn thấy được bức tranh tổng thể.',
        blocks: ['A00', 'A01', 'D01'],
        careers: ['Quản lý dự án', 'Chuyên viên chiến lược', 'Khởi nghiệp'],
      },
      {
        group: 'Giáo dục',
        name: 'Quản lý giáo dục',
        score: 82,
        because: [0, 2],
        description:
          'Tổ chức và dẫn dắt môi trường học tập để mỗi người tìm được con đường của mình.',
        blocks: ['C00', 'D01'],
        careers: ['Quản lý trường học', 'Điều phối chương trình', 'Tư vấn hướng nghiệp'],
      },
    ],
    others: [
      { name: 'Luật', score: 80 },
      { name: 'Quan hệ quốc tế', score: 77 },
      { name: 'Sư phạm', score: 75 },
      { name: 'Quản lý nhà nước', score: 72 },
      { name: 'Quản trị du lịch', score: 69 },
    ],
  },
  temper: {
    createdAt: '2026-10-22',
    isDemo: true,
    majors: [
      {
        group: 'Kinh tế – Vận hành',
        name: 'Logistics và chuỗi cung ứng',
        score: 91,
        because: [2, 1],
        description:
          'Giữ cho dòng hàng hoá vận hành nhịp nhàng từ nhà máy đến tay người dùng. Sự nhất quán và khả năng phối hợp của bạn là lợi thế.',
        blocks: ['A00', 'A01', 'D01'],
        careers: ['Điều phối logistics', 'Chuyên viên chuỗi cung ứng', 'Quản lý kho vận'],
      },
      {
        group: 'Tài chính',
        name: 'Kế toán',
        score: 86,
        because: [2, 0],
        description:
          'Theo dõi dòng tiền với sự đều đặn và cẩn thận. Hợp với người làm việc có nhịp, ổn định và đáng tin cậy.',
        blocks: ['A00', 'A01', 'D01'],
        careers: ['Kế toán viên', 'Kiểm soát nội bộ', 'Chuyên viên tài chính'],
      },
      {
        group: 'Nghệ thuật',
        name: 'Âm nhạc ứng dụng',
        score: 80,
        because: [0, 1],
        description:
          'Sản xuất, phối khí và biểu diễn âm nhạc. Khả năng cảm nhận nhịp tự nhiên của bạn có thể phát triển thành nghề.',
        blocks: ['N00'],
        careers: ['Nhà sản xuất âm nhạc', 'Kỹ thuật viên âm thanh', 'Nghệ sĩ biểu diễn'],
      },
    ],
    others: [
      { name: 'Quản trị khách sạn', score: 79 },
      { name: 'Tài chính – Ngân hàng', score: 77 },
      { name: 'Quản lý công nghiệp', score: 74 },
      { name: 'Hệ thống thông tin quản lý', score: 71 },
      { name: 'Quản trị văn phòng', score: 69 },
    ],
  },
  storyteller: {
    createdAt: '2026-10-22',
    isDemo: true,
    majors: [
      {
        group: 'Truyền thông – Sáng tạo',
        name: 'Truyền thông đa phương tiện',
        score: 92,
        because: [0, 2],
        description:
          'Kể chuyện qua video, hình ảnh và nền tảng số. Bạn có thể tạo ra nội dung ý nghĩa, chạm cảm xúc và lan toả giá trị.',
        blocks: ['D01', 'A01', 'C00'],
        careers: ['Nhà sáng tạo nội dung', 'Biên kịch', 'Nhà sản xuất video'],
      },
      {
        group: 'Ngôn ngữ – Xã hội',
        name: 'Quan hệ công chúng',
        score: 88,
        because: [1, 2],
        description:
          'Làm cầu nối giữa tổ chức và cộng đồng. Khả năng thấu hiểu và kết nối giúp bạn tạo ảnh hưởng tích cực.',
        blocks: ['D01', 'C00', 'D14'],
        careers: ['Chuyên viên PR', 'Quản lý truyền thông', 'Tổ chức sự kiện'],
      },
      {
        group: 'Sáng tạo – Nghệ thuật',
        name: 'Thiết kế đồ hoạ',
        score: 85,
        because: [0, 1],
        description:
          'Kể chuyện bằng ngôn ngữ thị giác, tạo ra những sản phẩm hình ảnh giàu cảm xúc và mang dấu ấn cá nhân.',
        blocks: ['H00', 'V00', 'D01'],
        careers: ['Nhà thiết kế', 'Họa sĩ minh hoạ', 'Art director'],
      },
    ],
    others: [
      { name: 'Marketing', score: 82 },
      { name: 'Báo chí', score: 78 },
      { name: 'Tâm lý học', score: 75 },
      { name: 'Ngôn ngữ Anh', score: 72 },
      { name: 'Quản trị sự kiện', score: 70 },
    ],
  },
};
