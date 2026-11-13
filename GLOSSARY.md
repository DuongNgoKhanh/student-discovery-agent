# Student Discovery Agent

Trợ lý AI tư vấn hướng nghiệp cho học sinh THPT: học sinh trò chuyện với agent, làm bài khám phá tính cách và tra cứu thông tin tuyển sinh. Mã module, quy tắc (M-*, QT-*) theo [SRS](docs/srs/SRS_v2.pdf).

## Agent và tool (M-AGT)

**Tool**:
Một năng lực mà agent được phép gọi trong một lượt, do code khai báo và release chỉ bật, điền tham số hoặc đổi mô tả (QT-14). Định danh bằng tên và version, ví dụ `knowledge.search` v1.
_Avoid_: function, action, skill

**Tool binding**:
Việc một agent release bật một tool cụ thể, kèm tham số Studio điền và mô tả tuỳ chọn. Tool không có binding trong release đã pin thì không gọi được.
_Avoid_: tool config, enabled tool

**Tool kind**:
Một trong ba cách tool tham gia lượt: query tool, handoff tool hoặc reply tool.

**Query tool**:
Tool trả dữ liệu về cho model rồi để model viết tiếp, ví dụ `knowledge.search`, `result.explain`.
_Avoid_: read tool, lookup

**Handoff tool**:
Tool kết thúc lượt của model khi thành công; server tự dựng khối tiếp theo (câu hỏi, xác nhận, thẻ), nên model không bao giờ tự viết nội dung bài khám phá. Ví dụ `assessment.start`.
_Avoid_: action tool, terminal tool

**Reply tool**:
Tool không thực thi gì, chỉ góp thêm phần hiển thị vào câu trả lời của model, ví dụ `ui.suggest_replies`. Không dùng được trong chatflow.
_Avoid_: UI tool

**Handoff**:
Lời gọi handoff tool đã được chấp nhận trong một lượt; mọi lời gọi tool sau nó trong lượt đó bị bỏ.

**Tool group**:
Các tool có kết quả liên quan nhau trong cùng một lượt, ví dụ `knowledge.show` chỉ hiển thị được ref mà `knowledge.search` vừa trả trong lượt đó.

**Toolbox**:
Tập tool mà một lượt được phép dùng: đúng các tool binding của agent release đã pin cho hội thoại.
_Avoid_: tool set, executor

## Nội dung và phiên bản

**Ref**:
Mã tạm (k1, k2…) trỏ tới một tài liệu Knowledge Base kèm revision, chỉ có hiệu lực trong lượt đã trả nó ra (QT-13).
_Avoid_: citation id, source id

**Pin**:
Việc một hội thoại giữ cố định agent release, và một activity giữ cố định experience release, cho tới khi kết thúc (QT-06).
_Avoid_: lock, snapshot
