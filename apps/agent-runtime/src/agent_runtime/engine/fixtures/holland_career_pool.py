"""Master Holland RIASEC Career Question Pool & Deterministic Definition Builder (Task C-03 / M-ENG).

Provides:
- 60 localized career activity questions (10 items per house) adapted from the O*NET
  Interest Profiler for Vietnamese high school students (grades 10-12).
- Deterministic sampler to construct fully compliant Definition 2.0 ExperienceDefinitionDocument
  instances (30 items, baseline 12 items, 6 houses, exact tie policy).
"""

import copy
import random
from typing import Any, Dict, List, Optional, Union

from agent_runtime.evaluations.schemas.experience import ExperienceDefinitionDocument

# ------------------------------------------------------------------------------
# House Identifiers & Metadata (ADR-002 §7.3 & PR #13 / G0-04)
# ------------------------------------------------------------------------------

HOUSE_IDS = [
    "house_r",
    "house_i",
    "house_a",
    "house_s",
    "house_e",
    "house_c",
]

HOUSE_CODE_MAP = {
    "house_r": "r",
    "house_i": "i",
    "house_a": "a",
    "house_s": "s",
    "house_e": "e",
    "house_c": "c",
}

HOUSE_METADATA: List[Dict[str, Any]] = [
    {
        "house_id": "house_r",
        "name": "Hệ Khám Phá (Realistic)",
        "theme_ref": "theme_realistic_crimson",
        "mascot_ref": "mascot_phoenix_maker",
        "quote": "Hành động thực tế biến bản thiết kế thành thế giới hữu hình.",
        "strengths": [
            "Kỹ năng thực hành xuất sắc",
            "Tư duy không gian và cơ khí",
            "Thích ứng cao với công cụ thực tế",
        ],
        "tendencies": [
            "Thích làm việc với máy móc, công cụ hoặc hoạt động ngoài trời",
            "Hành động thực chiến hơn là lý thuyết suông",
            "Giải quyết vấn đề bằng kết quả trực quan hữu hình",
        ],
        "suggested_fields": [
            "Kỹ thuật Cơ điện tử & Robot",
            "Kỹ thuật Xây dựng & Giao thông",
            "Nông nghiệp Công nghệ cao",
            "Kỹ thuật Ô tô",
        ],
    },
    {
        "house_id": "house_i",
        "name": "Hệ Tư Duy (Investigative)",
        "theme_ref": "theme_investigative_sapphire",
        "mascot_ref": "mascot_owl_sage",
        "quote": "Tri thức là chiếc chìa khóa giải mã mọi quy luật của tự nhiên.",
        "strengths": [
            "Tư duy phân tích và logic sắc bén",
            "Khả năng nghiên cứu chuyên sâu",
            "Hiểu biết dữ liệu và mô hình hóa toán học",
        ],
        "tendencies": [
            "Thích tìm hiểu nguyên lý sâu xa của sự vật hiện tượng",
            "Đam mê giải mã bài toán dữ liệu phức tạp",
            "Ưa thích môi trường nghiên cứu độc lập và học thuật",
        ],
        "suggested_fields": [
            "Khoa học Dữ liệu & Trí tuệ Nhân tạo",
            "Công nghệ Thông tin & Khoa học Máy tính",
            "Công nghệ Sinh học & Hóa sinh",
            "Kinh tế học & Nghiên cứu Tài chính",
        ],
    },
    {
        "house_id": "house_a",
        "name": "Hệ Sáng Tạo (Artistic)",
        "theme_ref": "theme_artistic_amber",
        "mascot_ref": "mascot_chameleon_artist",
        "quote": "Sự khác biệt và cảm xúc chính là nguồn cội của nghệ thuật.",
        "strengths": [
            "Trực giác thẩm mỹ vượt trội",
            "Tư duy phi tuyến tính và đổi mới sáng tạo",
            "Khả năng truyền tải thông điệp bằng nghệ thuật và hình ảnh",
        ],
        "tendencies": [
            "Yêu thích tự do sáng tạo, không gò bó khuôn khổ cứng nhắc",
            "Nhạy cảm với cảm xúc, câu chuyện và vẻ đẹp",
            "Thể hiện bản thân qua tác phẩm thiết kế, nghệ thuật hoặc truyền thông",
        ],
        "suggested_fields": [
            "Thiết kế Đồ họa & Đa phương tiện",
            "Truyền thông & Báo chí Hiện đại",
            "Thiết kế Game & Kỹ xảo Hoạt hình",
            "Kiến trúc & Thiết kế Nội thất",
        ],
    },
    {
        "house_id": "house_s",
        "name": "Hệ Gắn Kết (Social)",
        "theme_ref": "theme_social_emerald",
        "mascot_ref": "mascot_dolphin_healer",
        "quote": "Thấu hiểu và sẻ chia mang lại sự thay đổi bền vững cho con người.",
        "strengths": [
            "Khả năng lắng nghe thấu cảm",
            "Kỹ năng sư phạm và truyền đạt kiến thức",
            "Năng lực gắn kết và xây dựng cộng đồng",
        ],
        "tendencies": [
            "Thích chăm sóc, hỗ trợ và phát triển tiềm năng của người khác",
            "Ưa thích làm việc nhóm trong môi trường tương tác thân thiện",
            "Quan tâm sâu sắc đến giá trị con người và tác động xã hội",
        ],
        "suggested_fields": [
            "Sư phạm & Giáo dục Đổi mới",
            "Tâm lý học & Công tác Xã hội",
            "Y đa khoa & Điều dưỡng Chăm sóc sức khỏe",
            "Quản trị Nhân sự & Trải nghiệm Con người",
        ],
    },
    {
        "house_id": "house_e",
        "name": "Hệ Tiên Phong (Enterprising)",
        "theme_ref": "theme_enterprising_ruby",
        "mascot_ref": "mascot_lion_leader",
        "quote": "Dẫn dắt bằng tầm nhìn, bứt phá bằng hành động quyết liệt.",
        "strengths": [
            "Kỹ năng lãnh đạo và truyền cảm hứng",
            "Tư duy chiến lược kinh doanh",
            "Dám chấp nhận thử thách và quản trị rủi ro",
        ],
        "tendencies": [
            "Thích khởi xướng, điều phối và thúc đẩy đội ngũ đạt mục tiêu",
            "Tham vọng đạt được thành quả kinh tế và khẳng định vị thế",
            "Tự tin trong đàm phán, thuyết phục và mở rộng mạng lưới quan hệ",
        ],
        "suggested_fields": [
            "Quản trị Kinh doanh & Khởi nghiệp",
            "Marketing & Phát triển Thị trường",
            "Thương mại Quốc tế & Logistics",
            "Tài chính Doanh nghiệp & Đầu tư",
        ],
    },
    {
        "house_id": "house_c",
        "name": "Hệ Chu Toàn (Conventional)",
        "theme_ref": "theme_conventional_amethyst",
        "mascot_ref": "mascot_beaver_curator",
        "quote": "Sự chuẩn xác và quy củ là nền móng cho mọi tổ chức vững mạnh.",
        "strengths": [
            "Tính cẩn trọng và chuẩn xác đến từng chi tiết",
            "Năng lực thiết lập quy trình chuẩn mực",
            "Quản lý dữ liệu và kiểm soát tuân thủ xuất sắc",
        ],
        "tendencies": [
            "Thích công việc rõ ràng, ngăn nắp và có cấu trúc trật tự",
            "Đáng tin cậy trong việc duy trì vận hành hệ thống ổn định",
            "Xem trọng tính chính xác, quy chuẩn và số liệu thực tế",
        ],
        "suggested_fields": [
            "Kế toán & Kiểm toán Chuyên nghiệp",
            "Phân tích Nghiệp vụ Kinh doanh (BA)",
            "Quản trị Hệ thống Thông tin & An toàn Vận hành",
            "Luật Doanh nghiệp & Quản lý Hành chính",
        ],
    },
]

# ------------------------------------------------------------------------------
# 60 Localized Holland RIASEC Career Questions (10 items per House)
# ------------------------------------------------------------------------------

HOLLAND_MASTER_CAREER_POOL: Dict[str, List[str]] = {
    "house_r": [
        "Lắp ráp, sửa chữa linh kiện máy tính, mô hình robot hoặc thiết bị điện tử gia đình",
        "Chế tạo các vật dụng hữu ích bằng gỗ, kim loại hoặc vật liệu tái chế trong xưởng thực hành",
        "Chăm sóc cây trồng, tìm hiểu hệ thống tưới tự động trong nhà màng nông nghiệp công nghệ cao",
        "Kiểm tra, tìm hiểu nguyên lý vận hành và bảo dưỡng động cơ xe máy hoặc thiết bị cơ khí",
        "Lắp đặt hệ thống dây mạng Internet, camera giám sát hoặc thiết bị nhà thông minh",
        "Vận hành máy in 3D, máy cắt laser để tạo ra các chi tiết sản phẩm mẫu",
        "Tham gia khảo sát địa hình thực tế, đo đạc thông số cho các công trình xây dựng",
        "Lắp đặt và thử nghiệm hệ thống pin năng lượng mặt trời mini",
        "Kiểm tra độ bền cơ học và chất lượng kỹ thuật của linh kiện trước khi đưa vào sử dụng",
        "Thực hiện các công việc kỹ thuật thực chiến ngoài trời đòi hỏi sự khéo léo và sức bền",
    ],
    "house_i": [
        "Thực hiện các thí nghiệm phản ứng hóa học hoặc nuôi cấy vi sinh trong phòng lab",
        "Lập trình thuật toán phần mềm để tự động hóa xử lý công việc hoặc giải quyết câu đố logic",
        "Phân tích biểu đồ dữ liệu thống kê để tìm ra xu hướng và quy luật tiềm ẩn",
        "Nghiên cứu nguyên nhân ô nhiễm môi trường và đề xuất giải pháp xử lý nước thải sinh hoạt",
        "Khám phá cấu trúc gen, tế bào sinh học và cơ chế tác dụng của các loại thuốc mới",
        "Tìm hiểu về chuyển động các hành tinh, thiên văn học và vật lý lượng tử",
        "Điều tra nguồn gốc, phân tích nguyên nhân khoa học dẫn đến sự cố kỹ thuật hoặc dịch bệnh",
        "Đọc và viết các bài báo cáo tổng hợp kết quả nghiên cứu khoa học chuyên sâu",
        "Xây dựng mô hình toán học để dự báo thời tiết hoặc biến động tài chính",
        "Thử nghiệm và đánh giá tính chất của các loại vật liệu mới công nghệ nano",
    ],
    "house_a": [
        "Vẽ tranh minh họa số (digital painting), thiết kế nhân vật truyện tranh hoặc hoạt hình",
        "Sáng tác kịch bản phim ngắn, viết truyện hoặc biên soạn nội dung video nghệ thuật",
        "Chơi một nhạc cụ, sáng tác giai điệu bài hát hoặc phối khí âm thanh trên máy tính",
        "Dựng video, chỉnh sửa hiệu ứng kỹ xảo điện ảnh và biên tập âm thanh chuyên nghiệp",
        "Thiết kế trang phục thời trang, phối màu trang phục hoặc bài trí nội thất phòng ở",
        "Chụp ảnh nghệ thuật, căn chỉnh ánh sáng và biên tập phóng sự ảnh về cuộc sống",
        "Tham gia diễn xuất trong một vở kịch sân khấu hoặc lồng tiếng cho nhân vật hoạt hình",
        "Thiết kế giao diện người dùng (UI/UX) cho các ứng dụng di động và website sáng tạo",
        "Viết bài phê bình nghệ thuật, cảm nhận văn học hoặc đánh giá các tác phẩm điện ảnh",
        "Sáng tạo các ấn phẩm truyền thông, poster và logo độc đáo cho sự kiện",
    ],
    "house_s": [
        "Giảng giải bài học, kèm cặp phương pháp học tập hiệu quả cho các bạn học sinh",
        "Lắng nghe, chia sẻ và tư vấn giúp bạn bè giải tỏa căng thẳng tâm lý học đường",
        "Tổ chức và tham gia các chiến dịch thiện nguyện giúp đỡ trẻ em có hoàn cảnh khó khăn",
        "Hướng dẫn các kỹ năng sơ cấp cứu ban đầu và chăm sóc sức khỏe cộng đồng",
        "Làm quản trò, tổ chức các hoạt động sinh hoạt tập thể và gắn kết tinh thần đồng đội",
        "Tham gia định hướng nghề nghiệp và chia sẻ kinh nghiệm chọn trường cho học sinh khóa dưới",
        "Điều phối các câu lạc bộ thiện nguyện, dự án nâng cao nhận thức xã hội của giới trẻ",
        "Chăm sóc, dạy học và hỗ trợ sinh hoạt cho các em nhỏ tại mái ấm tình thương",
        "Làm cầu nối hòa giải, giúp đỡ giải quyết các mâu thuẫn bất đồng trong tập thể lớp",
        "Tập huấn kỹ năng giao tiếp, thuyết trình và làm việc nhóm cho các thành viên mới",
    ],
    "house_e": [
        "Lên ý tưởng kinh doanh và tổ chức gian hàng buôn bán gây quỹ tại hội chợ trường",
        "Thuyết trình giới thiệu dự án, kêu gọi bạn bè và nhà tài trợ ủng hộ ý tưởng mới",
        "Đảm nhận vai trò nhóm trưởng, điều phối và phân công nhiệm vụ cho các thành viên",
        "Đàm phán, thương lượng với đối tác để đạt được điều khoản có lợi nhất cho tập thể",
        "Lên chiến dịch truyền thông marketing thu hút đông đảo học sinh tham gia sự kiện",
        "Chủ trì các buổi họp thảo luận, định hướng chiến lược hoạt động cho câu lạc bộ",
        "Quản lý ngân sách tài chính và theo dõi doanh số bán hàng của một dự án thanh niên",
        "Tham gia các cuộc thi tranh biện, bảo vệ quan điểm quyết liệt trước ban giám khảo",
        "Khởi xướng phong trào đổi mới sáng tạo, thúc đẩy tinh thần hành động trong tập thể",
        "Dẫn dắt đội nhóm vượt qua áp lực thi đua để đạt thành tích cao nhất trong các kỳ thi",
    ],
    "house_c": [
        "Lập bảng tính Excel chi tiết theo dõi thu chi và quản lý minh bạch quỹ lớp",
        "Soát lỗi chính tả, kiểm tra cẩn thận từng số liệu trong báo cáo và biểu mẫu văn bản",
        "Sắp xếp, lưu trữ tài liệu học tập, hồ sơ và danh mục sách trong thư viện ngăn nắp",
        "Kiểm kê chính xác số lượng thiết bị, dụng cụ thí nghiệm và tài sản chung trong phòng học",
        "Lập và tuân thủ thời gian biểu biểu, quy trình làm việc khoa học, đúng thời hạn",
        "Nhập liệu và cập nhật chính xác cơ sở dữ liệu thông tin học sinh vào hệ thống",
        "Đối chiếu các hóa đơn, chứng từ mua sắm để phát hiện sai sót số liệu kịp thời",
        "Xây dựng nội quy, tiêu chuẩn tác phong và quy chế sinh hoạt chung cho câu lạc bộ",
        "Soạn thảo công văn, biên bản cuộc họp và thư mời theo đúng quy chuẩn hành chính",
        "Giám sát và bảo đảm mọi hoạt động của nhóm diễn ra đúng quy định và kế hoạch đề ra",
    ],
}

STANDARD_CHOICE_LABELS: Dict[int, str] = {
    1: "Rất không thích",
    2: "Không thích",
    3: "Trung lập",
    4: "Thích",
    5: "Rất thích",
}

# ------------------------------------------------------------------------------
# Deterministic Definition Sampler
# ------------------------------------------------------------------------------

def sample_experience_definition(
    pool: Optional[Dict[str, List[str]]] = None,
    seed: Optional[Union[int, str]] = None,
    house_item_indices: Optional[Dict[str, List[int]]] = None,
    definition_id: str = "def_holland_career_v2",
    definition_version: str = "2.0.0",
    return_dict: bool = False,
) -> Union[ExperienceDefinitionDocument, Dict[str, Any]]:
    """Deterministically construct a valid Definition 2.0 ExperienceDefinitionDocument.

    Args:
        pool: Question pool mapping house_id to list of prompts (defaults to HOLLAND_MASTER_CAREER_POOL).
        seed: Seed for reproducible random sampling of 5 items per house.
        house_item_indices: Explicit distinct pool indices (5 per house) to select from the pool.
        definition_id: Unique definition identifier matching pattern ^[A-Za-z0-9][A-Za-z0-9._:-]*$.
        definition_version: Semantic version of the definition.
        return_dict: If True, returns the raw (unvalidated) dict; otherwise the validated model.

    Returns:
        ExperienceDefinitionDocument, or the raw document dict when return_dict is True.

    Raises:
        ValueError: If the pool or house_item_indices cannot supply 5 distinct items per house.
    """
    active_pool = HOLLAND_MASTER_CAREER_POOL if pool is None else pool
    rng = random.Random(seed) if seed is not None else None

    for house_id in HOUSE_IDS:
        if len(active_pool.get(house_id, [])) < 5:
            raise ValueError(f"Pool must provide at least 5 prompts for {house_id}")
    unknown_index_houses = set(house_item_indices or {}) - set(HOUSE_IDS)
    if unknown_index_houses:
        raise ValueError(f"house_item_indices has unknown houses: {sorted(unknown_index_houses)}")

    questions: List[Dict[str, Any]] = []

    for house_id in HOUSE_IDS:
        code = HOUSE_CODE_MAP[house_id]
        house_prompts = active_pool[house_id]

        if house_item_indices and house_id in house_item_indices:
            indices = house_item_indices[house_id]
            if len(indices) != 5:
                raise ValueError(f"Expected exactly 5 indices for {house_id}, got {len(indices)}")
            if len(set(indices)) != 5 or not all(0 <= idx < len(house_prompts) for idx in indices):
                raise ValueError(f"Indices for {house_id} must be distinct and within the pool: {indices}")
            selected_prompts = [house_prompts[idx] for idx in indices]
        elif rng is not None:
            # Deterministic sample 5 items without replacement
            indices = list(range(len(house_prompts)))
            rng.shuffle(indices)
            selected_prompts = [house_prompts[idx] for idx in sorted(indices[:5])]
        else:
            # Default: first 5 items
            selected_prompts = house_prompts[:5]

        for order, prompt in enumerate(selected_prompts, start=1):
            qid = f"q_{code}_{order:02}"
            choices = [
                {
                    "option_id": f"{qid}_opt_{rating}",
                    "label": STANDARD_CHOICE_LABELS[rating],
                    "rating": rating,
                }
                for rating in range(1, 6)
            ]
            questions.append({
                "question_id": qid,
                "house_id": house_id,
                "item_order": order,
                "prompt": prompt,
                "choices": choices,
            })

    # Sort questions consistently: by item_order 1..5, then by house_id
    # This guarantees questions[:12] exactly matches the 12 baseline items (2 per house)
    ordered_questions: List[Dict[str, Any]] = []
    for order in range(1, 6):
        for house_id in HOUSE_IDS:
            q = next(
                item for item in questions
                if item["house_id"] == house_id and item["item_order"] == order
            )
            ordered_questions.append(q)
    questions = ordered_questions

    # Construct standard baseline_order (12 items): R1, I1, A1, S1, E1, C1, R2, I2, A2, S2, E2, C2
    baseline_order: List[str] = [q["question_id"] for q in questions[:12]]

    rules = {
        "selection_rules": {
            "rule_schema_ref": "rule.schema.localis.selection.adaptive_bounds:v1",
            "engine_version": "career-assessment-v1",
            "payload": {
                "baseline_order": baseline_order,
                "selector": "widest_bound_gap",
                "fallback": "tie_order_then_item_order",
            },
        },
        "scoring_rules": {
            "rule_schema_ref": "rule.schema.localis.scoring.mean_rating:v1",
            "engine_version": "career-assessment-v1",
            "payload": {
                "algorithm": "mean_rating",
                "rating_scale": [1, 5],
            },
        },
        "coverage_rules": {
            "rule_schema_ref": "rule.schema.localis.coverage.bounded_stop:v1",
            "engine_version": "career-assessment-v1",
            "payload": {
                "items_per_house": 5,
                "baseline_total": 12,
                "min_answers_per_house": 2,
                "max_total": 30,
                "stop": "strict_bounds",
            },
        },
        "tie_policy": {
            "rule_schema_ref": "rule.schema.localis.tie.fixed_order:v1",
            "engine_version": "career-assessment-v1",
            "payload": {
                "order": copy.deepcopy(HOUSE_IDS),
                "apply_at": "question_limit",
            },
        },
    }

    templates = {
        "intro_prompt": "Chào bạn, hãy cùng khám phá 6 Hệ tính cách định hướng nghề nghiệp Holland RIASEC!",
        "clarification_prompt": "Ý bạn là gì trong các mức độ sau?",
        "completion_message": "Chúc mừng bạn đã hoàn thành bài khảo sát! Dưới đây là kết quả của bạn.",
    }

    # Deterministic baseline evaluation case: all 30 questions rating 3
    all_qids = [q["question_id"] for q in questions]
    eval_answers = [
        {"question_id": qid, "option_id": f"{qid}_opt_3"}
        for qid in all_qids
    ]
    evaluation_cases = [
        {
            "case_id": "eval_all_neutral_tie_to_r",
            "mandatory": True,
            "answers": eval_answers,
            "expected": {
                "question_ids": all_qids,
                "house_id": "house_r",
                "scores": {house_id: 3.0 for house_id in HOUSE_IDS},
                "stopping_reason": "question_limit",
                "tie_applied": True,
            },
        }
    ]

    doc_data: Dict[str, Any] = {
        "schema_version": "2.0",
        "definition_id": definition_id,
        "definition_version": definition_version,
        "engine_version": "career-assessment-v1",
        "is_demo": True,
        "houses": copy.deepcopy(HOUSE_METADATA),
        "questions": questions,
        "selection_rules": rules["selection_rules"],
        "scoring_rules": rules["scoring_rules"],
        "coverage_rules": rules["coverage_rules"],
        "tie_policy": rules["tie_policy"],
        "templates": templates,
        "evaluation_cases": evaluation_cases,
        "approval_refs": ["audit_initial_setup", "spec_adr_002_pilot"],
    }

    if return_dict:
        return doc_data

    return ExperienceDefinitionDocument.model_validate(doc_data)
