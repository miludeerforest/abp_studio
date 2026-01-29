"""
Video Prompt Optimizer for Multi-Model Support
Optimizes video generation prompts for GROK Aurora, SORA 2, and VEO 3.1
"""

import re
from typing import List, Dict, Optional


class PromptOptimizer:
    """
    Universal video prompt optimizer supporting multiple video generation models.
    
    Model Specifications:
    - GROK Aurora: < 180 chars (~30 words), first 20-30 words most important
    - SORA 2: 40-80 words, requires safety suffix
    - VEO 3.1: 30-50 words, concise sentences with cause-effect relationships
    """
    
    FILLER_WORDS = [
        "that is", "which is", "there is", "there are",
        "very", "really", "extremely", "significantly",
        "beautiful", "stunning", "amazing", "wonderful",
        "professional", "high-quality", "detailed"
    ]
    
    SORA2_SAFETY_SUFFIX = (
        "No text, subtitles, watermarks. "
        "Hands and faces photorealistic. "
        "Single continuous take. "
        "No jarring cuts or morphing."
    )
    
    @classmethod
    def optimize_for_model(cls, prompt: str, model_name: str) -> str:
        """
        Main entry point: optimize prompt based on target model.
        
        Args:
            prompt: Original prompt text
            model_name: Target model (e.g., "grok-aurora", "sora2-portrait-15s", "veo3")
        
        Returns:
            Optimized prompt string
        """
        model_lower = model_name.lower()
        
        if "grok" in model_lower or "aurora" in model_lower:
            return cls._optimize_for_grok(prompt)
        elif "sora" in model_lower:
            return cls._optimize_for_sora2(prompt)
        elif "veo" in model_lower:
            return cls._optimize_for_veo3(prompt)
        else:
            return cls._compress_generic(prompt, max_words=50)
    
    @classmethod
    def _optimize_for_grok(cls, prompt: str, max_chars: int = 180) -> str:
        """
        GROK Aurora optimization: ultra-short, front-loaded.
        
        Strategy:
        1. Remove filler words
        2. Extract key visual elements
        3. Truncate to < 180 chars
        4. Ensure first 30 words are most important
        """
        compressed = cls._remove_fillers(prompt)
        compressed = cls._extract_key_elements(compressed)
        
        if len(compressed) > max_chars:
            compressed = cls._smart_truncate(compressed, max_chars)
        
        return compressed.strip(" ,.")
    
    @classmethod
    def _optimize_for_sora2(cls, prompt: str) -> str:
        """
        SORA 2 optimization: detailed + safety suffix.
        
        Strategy:
        1. Keep prompt relatively detailed (40-80 words)
        2. Add mandatory safety suffix
        3. Structure: Subject + Action + Environment + Camera + Lighting
        """
        words = prompt.split()
        
        if len(words) > 80:
            prompt = " ".join(words[:75])
        elif len(words) < 40:
            pass
        
        if cls.SORA2_SAFETY_SUFFIX not in prompt:
            prompt = f"{prompt} {cls.SORA2_SAFETY_SUFFIX}"
        
        return prompt.strip()
    
    @classmethod
    def _optimize_for_veo3(cls, prompt: str, max_words: int = 50) -> str:
        """
        VEO 3.1 optimization: concise, cause-effect, audio-aware.
        
        Strategy:
        1. Prefer complete sentences over comma-separated lists
        2. Use cause-effect relationships
        3. Keep under 50 words
        4. Use colons for dialogue (not quotes)
        """
        compressed = cls._remove_fillers(prompt)
        words = compressed.split()
        
        if len(words) > max_words:
            compressed = " ".join(words[:max_words])
        
        compressed = compressed.replace('"', ':').replace("'", "")
        
        return compressed.strip(" ,.")
    
    @classmethod
    def _compress_generic(cls, prompt: str, max_words: int = 50) -> str:
        """Generic compression for unknown models."""
        compressed = cls._remove_fillers(prompt)
        words = compressed.split()
        
        if len(words) > max_words:
            compressed = " ".join(words[:max_words])
        
        return compressed.strip()
    
    @classmethod
    def _remove_fillers(cls, text: str) -> str:
        """Remove common filler words and phrases."""
        cleaned = text
        for filler in cls.FILLER_WORDS:
            cleaned = re.sub(r'\b' + re.escape(filler) + r'\b', '', cleaned, flags=re.IGNORECASE)
        
        cleaned = re.sub(r'\s+', ' ', cleaned)
        return cleaned.strip()
    
    @classmethod
    def _extract_key_elements(cls, text: str) -> str:
        """
        Extract visual keywords prioritizing action and subject.
        
        Priority: Subject → Action → Camera → Environment → Style
        """
        keywords = []
        
        action_verbs = r'\b(rotating|floating|rising|falling|rippling|shimmering|flowing|drifting|moving|shifting|glowing|pulsing)\b'
        camera_moves = r'\b(orbit|push-in|pull-back|dolly|crane|pan|tilt|tracking)\b'
        subjects = r'\b(product|speaker|bottle|device|character)\b'
        
        subject_matches = re.findall(subjects, text, re.IGNORECASE)
        action_matches = re.findall(action_verbs, text, re.IGNORECASE)
        camera_matches = re.findall(camera_moves, text, re.IGNORECASE)
        
        if subject_matches:
            keywords.append(subject_matches[0])
        if action_matches:
            keywords.extend(action_matches[:2])
        if camera_matches:
            keywords.append(camera_matches[0])
        
        remaining_words = [w for w in text.split() if len(w) > 3 and w.lower() not in keywords]
        keywords.extend(remaining_words[:10])
        
        return " ".join(keywords)
    
    @classmethod
    def _smart_truncate(cls, text: str, max_chars: int) -> str:
        """
        Truncate at last complete phrase before max_chars.
        
        Prefers cutting at: period > comma > space
        """
        if len(text) <= max_chars:
            return text
        
        truncated = text[:max_chars]
        
        last_period = truncated.rfind(".")
        last_comma = truncated.rfind(",")
        last_space = truncated.rfind(" ")
        
        cut_point = max(last_period, last_comma)
        
        if cut_point > max_chars * 0.6:
            return truncated[:cut_point]
        elif last_space > max_chars * 0.7:
            return truncated[:last_space]
        else:
            return truncated.rsplit(" ", 1)[0]


class PromptFormatter:
    """
    Helper to format prompts using structured components.
    """
    
    @staticmethod
    def format_for_grok(
        subject: str,
        action: str = "",
        camera: str = "slow orbit",
        style: str = "",
        dynamics: Optional[List[str]] = None
    ) -> str:
        """
        GROK Aurora format: [Subject] + [Action] + [Camera] + [Dynamics]
        
        Example:
            "Black speaker on marble, gentle rotation, slow orbit, golden light rays, floating dust"
        """
        parts = [subject]
        
        if action:
            parts.append(action)
        
        parts.append(camera)
        
        if dynamics:
            parts.extend(dynamics[:2])
        
        if style:
            parts.append(style)
        
        prompt = ", ".join(parts)
        return PromptOptimizer._optimize_for_grok(prompt, 180)
    
    @staticmethod
    def format_for_sora2(
        shot_type: str,
        subject: str,
        action: str,
        environment: str = "",
        lighting: str = "",
        camera: str = ""
    ) -> str:
        """
        SORA 2 format: [Shot] + [Subject] + [Action] + [Environment] + [Lighting] + [Camera]
        
        Example:
            "Medium shot. Black Bluetooth speaker on marble. Gentle 360 rotation. 
             Golden hour lighting. Soft bokeh background. Slow push-in camera."
        """
        parts = [f"{shot_type}."]
        
        if subject:
            parts.append(f"{subject}.")
        
        if action:
            parts.append(f"{action}.")
        
        if environment:
            parts.append(f"{environment}.")
        
        if lighting:
            parts.append(f"{lighting}.")
        
        if camera:
            parts.append(f"{camera}.")
        
        prompt = " ".join(parts)
        return PromptOptimizer._optimize_for_sora2(prompt)
    
    @staticmethod
    def format_for_veo3(
        cinematography: str,
        subject: str,
        action: str,
        context: str = "",
        style: str = "",
        audio_cue: str = ""
    ) -> str:
        """
        VEO 3.1 format: [Cinematography] + [Subject] + [Action] + [Context] + [Style] + [Audio]
        
        VEO3 特点: 音频优先，使用冒号代替引号表示对话
        
        Example:
            "Cinematic wide shot. Speaker on marble surface. Gentle rotation reveals details. 
             The sound of soft mechanical whir. Natural lighting, soft bokeh."
        """
        parts = [cinematography]
        
        if subject:
            parts.append(subject)
        
        if action:
            parts.append(action)
        
        if audio_cue:
            parts.append(f"The sound of {audio_cue}")
        
        if context:
            parts.append(context)
        
        if style:
            parts.append(style)
        
        prompt = ". ".join([p.rstrip(".") for p in parts if p]) + "."
        return PromptOptimizer._optimize_for_veo3(prompt)


def get_model_config(model_name: str) -> Dict:
    """
    Get model-specific configuration and limits.
    
    Returns:
        dict: {
            "type": "grok"|"sora2"|"veo3"|"generic",
            "max_chars": int,
            "max_words": int,
            "requires_safety_suffix": bool
        }
    """
    model_lower = model_name.lower()
    
    if "grok" in model_lower or "aurora" in model_lower:
        return {
            "type": "grok",
            "max_chars": 180,
            "max_words": 30,
            "requires_safety_suffix": False
        }
    elif "sora" in model_lower:
        return {
            "type": "sora2",
            "max_chars": 400,
            "max_words": 80,
            "requires_safety_suffix": True
        }
    elif "veo" in model_lower:
        return {
            "type": "veo3",
            "max_chars": 250,
            "max_words": 50,
            "requires_safety_suffix": False
        }
    else:
        return {
            "type": "generic",
            "max_chars": 300,
            "max_words": 60,
            "requires_safety_suffix": False
        }
