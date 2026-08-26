use regex::Regex;

const FILLERS: &[&str] = &[
    "that is",
    "which is",
    "there is",
    "there are",
    "very",
    "really",
    "extremely",
    "significantly",
    "beautiful",
    "stunning",
    "amazing",
    "wonderful",
    "professional",
    "high-quality",
    "detailed",
];
const SORA_SUFFIX: &str = "No text, subtitles, watermarks. Hands and faces photorealistic. Single continuous take. No jarring cuts or morphing.";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelConfig {
    pub kind: &'static str,
    pub max_chars: usize,
    pub max_words: usize,
    pub requires_safety_suffix: bool,
}

pub fn model_config(model: &str) -> ModelConfig {
    let model = model.to_ascii_lowercase();
    if model.contains("grok") || model.contains("aurora") {
        ModelConfig {
            kind: "grok",
            max_chars: 180,
            max_words: 30,
            requires_safety_suffix: false,
        }
    } else if model.contains("sora") {
        ModelConfig {
            kind: "sora2",
            max_chars: 400,
            max_words: 80,
            requires_safety_suffix: true,
        }
    } else if model.contains("veo") {
        ModelConfig {
            kind: "veo3",
            max_chars: 250,
            max_words: 50,
            requires_safety_suffix: false,
        }
    } else {
        ModelConfig {
            kind: "generic",
            max_chars: 300,
            max_words: 60,
            requires_safety_suffix: false,
        }
    }
}

pub fn optimize_for_model(prompt: &str, model: &str) -> String {
    let config = model_config(model);
    match config.kind {
        "grok" => optimize_grok(prompt, config.max_chars),
        "sora2" => optimize_sora(prompt, config.max_words),
        "veo3" => optimize_veo(prompt, config.max_words),
        _ => compress(prompt, config.max_words),
    }
}

pub fn format_sora2(
    shot_type: &str,
    subject: &str,
    action: &str,
    environment: &str,
    lighting: &str,
    camera: &str,
) -> String {
    let parts = [
        format!("{shot_type}."),
        sentence(subject),
        sentence(action),
        sentence(environment),
        sentence(lighting),
        sentence(camera),
    ];
    optimize_for_model(
        &parts
            .into_iter()
            .filter(|value| value != ".")
            .collect::<Vec<_>>()
            .join(" "),
        "sora2",
    )
}

fn optimize_grok(prompt: &str, max_chars: usize) -> String {
    let compressed = extract_key_elements(&remove_fillers(prompt));
    smart_truncate(&compressed, max_chars)
        .trim_matches([' ', ',', '.'])
        .to_string()
}

fn optimize_sora(prompt: &str, max_words: usize) -> String {
    let words: Vec<&str> = prompt.split_whitespace().collect();
    let mut output = if words.len() > max_words {
        words[..max_words].join(" ")
    } else {
        prompt.to_string()
    };
    if !output.contains(SORA_SUFFIX) {
        output.push(' ');
        output.push_str(SORA_SUFFIX);
    }
    output.trim().to_string()
}

fn optimize_veo(prompt: &str, max_words: usize) -> String {
    let cleaned = remove_fillers(prompt);
    let words: Vec<&str> = cleaned.split_whitespace().collect();
    words
        .into_iter()
        .take(max_words)
        .collect::<Vec<_>>()
        .join(" ")
        .replace('"', ":")
        .replace('\'', "")
        .trim_matches([' ', ',', '.'])
        .to_string()
}

fn compress(prompt: &str, max_words: usize) -> String {
    remove_fillers(prompt)
        .split_whitespace()
        .take(max_words)
        .collect::<Vec<_>>()
        .join(" ")
}

fn remove_fillers(text: &str) -> String {
    let mut output = text.to_string();
    for filler in FILLERS {
        output = Regex::new(&format!(r"(?i)\b{}\b", regex::escape(filler)))
            .expect("valid regex")
            .replace_all(&output, "")
            .to_string();
    }
    output.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn extract_key_elements(text: &str) -> String {
    let mut elements = Vec::new();
    for pattern in [
        r"(?i)\b(product|speaker|bottle|device|character)\b",
        r"(?i)\b(rotating|floating|rising|falling|rippling|shimmering|flowing|drifting|moving|shifting|glowing|pulsing)\b",
        r"(?i)\b(orbit|push-in|pull-back|dolly|crane|pan|tilt|tracking)\b",
    ] {
        if let Some(value) = Regex::new(pattern).expect("valid regex").find(text) {
            elements.push(value.as_str().to_string());
        }
    }
    elements.extend(
        text.split_whitespace()
            .filter(|word| word.len() > 3)
            .take(10)
            .map(str::to_string),
    );
    elements.join(" ")
}

fn smart_truncate(text: &str, max_chars: usize) -> String {
    if text.len() <= max_chars {
        return text.to_string();
    }
    let prefix = &text[..max_chars];
    let cut = prefix
        .rfind(['.', ','])
        .filter(|index| *index > max_chars * 3 / 5)
        .or_else(|| {
            prefix
                .rfind(' ')
                .filter(|index| *index > max_chars * 7 / 10)
        })
        .unwrap_or_else(|| prefix.rfind(' ').unwrap_or(max_chars));
    prefix[..cut].to_string()
}

fn sentence(value: &str) -> String {
    if value.is_empty() {
        ".".into()
    } else {
        format!("{}.", value.trim_end_matches('.'))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn model_limits_match_python_contract() {
        assert_eq!(model_config("grok-aurora").max_chars, 180);
        assert!(model_config("sora2").requires_safety_suffix);
    }
    #[test]
    fn sora_adds_safety_suffix() {
        assert!(optimize_for_model("A product rotates", "sora2").contains("No text"));
    }
    #[test]
    fn grok_is_short() {
        assert!(
            optimize_for_model(
                "A very beautiful professional product rotating with a slow orbit and golden light",
                "grok"
            )
            .len()
                <= 180
        );
    }
}
