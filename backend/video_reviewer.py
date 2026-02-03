"""
视频质量审查服务模块
通过 OAI 兼容 API 自动评估视频的 AI 感和内容质量
"""

import asyncio
import base64
import httpx
import json
import logging
import os
import subprocess
import tempfile
from datetime import datetime
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

# 审查提示词模板
REVIEW_PROMPT = """**【重要】请务必使用简体中文进行回复，所有评估结论、描述文字均需使用中文。**

你是一位专业的电商视频质量审核专家，专门评估 AI 生成视频的自然度和商业适用性。

⚠️ **重要提醒 - 关于"视频钩子"(Hook)内容**：
电商视频常用夸张的"钩子"内容来吸引用户注意力，这是正常的营销技巧，不应误判为敏感内容：
- ✅ 皮肤问题展示（痘痘、红疹、粗糙等） → 这是护肤品的"痛点钩子"，用于引起共鸣
- ✅ 前后对比展示（脏污→干净、损坏→修复） → 这是产品效果的"效果钩子"
- ✅ 夸张的问题场景（头发凌乱、皮肤暗沉等） → 这是美妆/美发的常见手法
- ✅ 宠物用品、医疗器械的使用场景 → 可能涉及轻微的创口或不适，但属于正常产品展示
- ❌ 真正需要拒绝的：真实暴力、血腥、恐怖、色情等违法违规内容

请分析这些视频帧，评估以下维度（每项 1-10 分，10分最佳，1分最差）：

1. **自然度** (ai_score): 视频看起来有多自然真实？
   - 8-10: 非常自然，几乎无法察觉是AI生成
   - 5-7: 有一些AI痕迹但可接受
   - 1-4: 明显是AI生成，容易被检测

2. **画面一致性** (consistency_score): 帧间过渡的流畅自然程度？
   - 检查物体形态、颜色、光影在不同帧间的一致性
   - 注意是否有闪烁、变形、融合等问题

3. **物理真实性** (physics_score): 物体运动符合物理规律的程度？
   - 重力、惯性、碰撞等是否自然
   - 液体、布料、头发等动态是否真实

4. **电商卖点** (ecommerce_score): 作为产品展示视频的效果？
   - 产品是否清晰可见、卖点突出
   - 场景是否吸引人
   - 是否适合用于电商平台宣传

5. **钩子价值** (hook_score): 作为吸引眼球的"钩子"视频的效果？
   - 8-10: 极具吸引力，能有效抓住用户注意力，痛点/效果展示到位
   - 5-7: 有一定吸引力，但不够突出
   - 1-4: 平淡无奇，难以在信息流中脱颖而出

6. **平台安全** (platform_risk): 能通过平台审核的可能性？
   - 评估可以安全在抖音、快手、小红书等平台发布的概率
   - 注意：电商类"钩子"内容（皮肤问题展示等）是平台允许的，不应降分

请以JSON格式返回评估结果：
```json
{
  "ai_score": <1-10>,
  "consistency_score": <1-10>,
  "physics_score": <1-10>,
  "ecommerce_score": <1-10>,
  "hook_score": <1-10>,
  "platform_risk": <1-10>,
  "overall_score": <1-10，综合评分>,
  "recommendation": "<pass/warning/reject>",
  "summary": "<一句话总结>",
  "issues": ["<问题1>", "<问题2>", ...],
  "strengths": ["<优点1>", "<优点2>", ...]
}
```

评分标准：
- overall_score 8-10: 优秀，可直接使用 (recommendation: pass)
- overall_score 5-7: 一般，谨慎使用 (recommendation: warning)
- overall_score 1-4: 较差，不建议使用 (recommendation: reject)

**综合评分计算时，请特别注意"钩子价值"：如果视频是有效的营销钩子，应适当提高综合评分。**

**再次提醒：summary（总结）、issues（问题列表）、strengths（优点列表）的内容必须使用简体中文书写！**
"""


async def extract_frames(video_path: str, num_frames: int = 8) -> list[str]:
    """
    从视频中提取关键帧并转为base64
    
    Args:
        video_path: 视频文件路径
        num_frames: 要提取的帧数
    
    Returns:
        base64编码的帧图片列表
    """
    frames = []
    
    try:
        # 创建临时目录
        with tempfile.TemporaryDirectory() as tmpdir:
            # 使用 ffmpeg 提取帧
            output_pattern = os.path.join(tmpdir, "frame_%03d.jpg")
            
            # 获取视频时长
            probe_cmd = [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                video_path
            ]
            result = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=30)
            duration = float(result.stdout.strip()) if result.stdout.strip() else 5.0
            
            # 计算帧率以均匀提取
            fps = num_frames / max(duration, 1)
            
            # 提取帧
            extract_cmd = [
                "ffmpeg", "-i", video_path,
                "-vf", f"fps={fps}",
                "-frames:v", str(num_frames),
                "-q:v", "2",  # 高质量JPEG
                output_pattern,
                "-y"
            ]
            subprocess.run(extract_cmd, capture_output=True, timeout=60)
            
            # 读取并编码帧
            for i in range(1, num_frames + 1):
                frame_path = os.path.join(tmpdir, f"frame_{i:03d}.jpg")
                if os.path.exists(frame_path):
                    with open(frame_path, "rb") as f:
                        frame_data = f.read()
                        frames.append(base64.b64encode(frame_data).decode("utf-8"))
                        
    except Exception as e:
        logger.error(f"Error extracting frames from {video_path}: {e}")
    
    return frames


async def review_video(
    video_path: str,
    video_prompt: str,
    api_url: str,
    api_key: str,
    model_name: str = "gpt-4o"
) -> Dict[str, Any]:
    """
    调用 OAI 兼容 API 审查视频质量
    
    Args:
        video_path: 视频文件路径
        video_prompt: 生成视频时使用的提示词
        api_url: API 服务地址
        api_key: API 密钥
        model_name: 模型名称
    
    Returns:
        审查结果字典
    """
    result = {
        "success": False,
        "ai_score": None,
        "overall_score": None,
        "recommendation": None,
        "summary": None,
        "details": None,
        "error": None
    }
    
    try:
        # 1. 提取视频帧
        frames = await extract_frames(video_path, num_frames=8)
        if not frames:
            result["error"] = "无法从视频提取帧"
            return result
        
        logger.info(f"Extracted {len(frames)} frames from video for review")
        
        # 2. 构建消息内容
        content = [
            {
                "type": "text",
                "text": f"视频生成提示词：{video_prompt}\n\n{REVIEW_PROMPT}"
            }
        ]
        
        # 添加帧图片
        for i, frame_b64 in enumerate(frames):
            content.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/jpeg;base64,{frame_b64}"
                }
            })
        
        # 3. 调用 API
        # 确保 API URL 格式正确
        if api_url.endswith("/"):
            api_url = api_url[:-1]
        if not api_url.endswith("/v1/chat/completions"):
            if "/v1" not in api_url:
                api_url = f"{api_url}/v1/chat/completions"
            else:
                api_url = f"{api_url}/chat/completions"
        
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                api_url,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": model_name,
                    "messages": [
                        {
                            "role": "user",
                            "content": content
                        }
                    ],
                    "max_tokens": 2000,
                    "temperature": 0.3
                }
            )
            
            if response.status_code != 200:
                result["error"] = f"API 请求失败: {response.status_code} - {response.text}"
                return result
            
            response_text_raw = response.text
            
            if response_text_raw.startswith("data:"):
                full_content = ""
                for line in response_text_raw.split("\n"):
                    line = line.strip()
                    if line.startswith("data:") and line != "data: [DONE]":
                        try:
                            chunk_data = json.loads(line[5:].strip())
                            choices = chunk_data.get("choices", [])
                            if choices:
                                delta = choices[0].get("delta", {})
                                if "content" in delta:
                                    full_content += delta["content"]
                        except json.JSONDecodeError:
                            continue
                response_text = full_content
            else:
                api_result = response.json()
                response_text = api_result.get("choices", [{}])[0].get("message", {}).get("content", "")
        
        # 记录原始响应便于调试（截取前500字符）
        logger.debug(f"Raw API response (first 500 chars): {response_text[:500]}")
        
        # 提取 JSON - 支持多种格式
        json_str = None
        
        # 方法1: 尝试提取 Markdown 代码块中的 JSON
        import re
        code_block_match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', response_text)
        if code_block_match:
            potential_json = code_block_match.group(1).strip()
            if potential_json.startswith('{'):
                json_str = potential_json
        
        # 方法2: 直接查找 { 和 } 边界
        if not json_str:
            json_start = response_text.find("{")
            json_end = response_text.rfind("}") + 1
            if json_start >= 0 and json_end > json_start:
                json_str = response_text[json_start:json_end]
        
        if json_str:
            try:
                review_data = json.loads(json_str)
                
                result["success"] = True
                result["ai_score"] = review_data.get("ai_score")
                result["overall_score"] = review_data.get("overall_score")
                result["recommendation"] = review_data.get("recommendation")
                result["summary"] = review_data.get("summary")
                result["details"] = review_data
            except json.JSONDecodeError as parse_err:
                result["error"] = f"JSON 解析错误: {parse_err}"
                result["details"] = {"raw_response": response_text[:1000], "extracted_json": json_str[:500]}
                logger.warning(f"JSON parse error. Extracted: {json_str[:200]}...")
        else:
            result["error"] = "无法解析API响应中的JSON"
            result["details"] = {"raw_response": response_text[:1000]}
            logger.warning(f"No JSON found in response: {response_text[:300]}...")
            
    except json.JSONDecodeError as e:
        result["error"] = f"JSON 解析错误: {e}"
    except httpx.TimeoutException:
        result["error"] = "API 请求超时"
    except Exception as e:
        result["error"] = f"审查过程出错: {str(e)}"
        logger.exception(f"Video review error: {e}")
    
    return result


async def trigger_video_review(
    video_id: str,
    video_path: str,
    video_prompt: str,
    db_session,
    VideoQueueItem_model
):
    """
    触发视频审查的后台任务
    
    Args:
        video_id: 视频队列项ID
        video_path: 视频文件路径
        video_prompt: 生成视频的提示词
        db_session: 数据库会话工厂
        VideoQueueItem_model: VideoQueueItem 模型类
    """
    from main import SystemConfig, get_china_now
    
    db = db_session()
    try:
        # 获取审查配置
        review_enabled = db.query(SystemConfig).filter(SystemConfig.key == "review_enabled").first()
        if not review_enabled or review_enabled.value.lower() != "true":
            logger.info(f"Video review disabled, skipping review for {video_id}")
            return
        
        review_api_url = db.query(SystemConfig).filter(SystemConfig.key == "review_api_url").first()
        review_api_key = db.query(SystemConfig).filter(SystemConfig.key == "review_api_key").first()
        review_model = db.query(SystemConfig).filter(SystemConfig.key == "review_model_name").first()
        
        if not review_api_url or not review_api_url.value or not review_api_key or not review_api_key.value:
            logger.warning(f"Review API not configured, skipping review for {video_id}")
            return
        
        # 更新状态为审查中
        item = db.query(VideoQueueItem_model).filter(VideoQueueItem_model.id == video_id).first()
        if not item:
            logger.error(f"Video item {video_id} not found")
            return
        
        item.review_status = "pending"
        db.commit()
        
        # 执行审查
        logger.info(f"Starting video review for {video_id}")
        review_result = await review_video(
            video_path=video_path,
            video_prompt=video_prompt,
            api_url=review_api_url.value,
            api_key=review_api_key.value,
            model_name=review_model.value if review_model else "gpt-4o"
        )
        
        # 更新审查结果
        item = db.query(VideoQueueItem_model).filter(VideoQueueItem_model.id == video_id).first()
        if item:
            if review_result["success"]:
                item.review_score = review_result["overall_score"]
                item.review_result = json.dumps(review_result["details"], ensure_ascii=False)
                item.review_status = "done"
                logger.info(f"Video review completed for {video_id}: score={review_result['overall_score']}")
                
                # 更新用户经验值
                if item.user_id:
                    from main import User, ExperienceLog, calculate_exp_change, calculate_level
                    
                    user = db.query(User).filter(User.id == item.user_id).first()
                    if user:
                        exp_change = calculate_exp_change(review_result["overall_score"])
                        exp_before = user.experience or 0
                        level_before = user.level or 1
                        
                        # 更新经验值（不低于0）
                        user.experience = max(0, exp_before + exp_change)
                        new_level, _ = calculate_level(user.experience)
                        user.level = new_level
                        user.exp_updated_at = get_china_now()
                        
                        # 记录变更日志
                        exp_log = ExperienceLog(
                            user_id=user.id,
                            video_id=video_id,
                            score=review_result["overall_score"],
                            exp_change=exp_change,
                            exp_before=exp_before,
                            exp_after=user.experience,
                            level_before=level_before,
                            level_after=new_level
                        )
                        db.add(exp_log)
                        
                        change_desc = "+" if exp_change > 0 else ""
                        logger.info(f"User {user.id} exp: {exp_before} -> {user.experience} ({change_desc}{exp_change}), level: {level_before} -> {new_level}")
            else:
                item.review_result = json.dumps({"error": review_result["error"]}, ensure_ascii=False)
                item.review_status = "error"
                logger.error(f"Video review failed for {video_id}: {review_result['error']}")
            
            item.reviewed_at = get_china_now()
            db.commit()
            
    except Exception as e:
        logger.exception(f"Error in video review task for {video_id}: {e}")
        try:
            item = db.query(VideoQueueItem_model).filter(VideoQueueItem_model.id == video_id).first()
            if item:
                item.review_status = "error"
                item.review_result = json.dumps({"error": str(e)}, ensure_ascii=False)
                db.commit()
        except:
            pass
    finally:
        db.close()
