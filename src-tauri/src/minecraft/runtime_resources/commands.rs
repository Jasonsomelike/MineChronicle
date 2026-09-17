//! Tauri command surface for runtime icon resolution.
use super::*;

#[tauri::command]
pub async fn store_stat_icon(
    cache_state: tauri::State<'_, IconCacheDir>,
    request: StoreIconRequest,
) -> Result<bool, String> {
    let Some(dir) = cache_state.get() else {
        return Ok(false);
    };
    let Some(bytes) = data_url_png(&request.png).or_else(|| STANDARD.decode(&request.png).ok())
    else {
        return Err("图标不是有效的PNG base64".into());
    };
    if bytes.len() as u64 > 2 * 1024 * 1024 {
        return Err("图标过大".into());
    }
    let Some((width, height)) = png_size(&bytes) else {
        return Err("图标不是有效PNG".into());
    };
    if request.width != width || request.height != height {
        return Err("图标尺寸与像素不一致".into());
    }
    let kind = if request.kind.is_empty() {
        "item".to_string()
    } else {
        request.kind
    };
    Ok(write_icon_cache(
        &dir,
        &request.cache_key,
        &bytes,
        (width, height),
        &kind,
        &request.source,
        &request.reason,
    ))
}

pub(crate) fn lookup_icon_cache_only(
    dir: Option<&Path>,
    category: &str,
    key: &str,
    roots: &[String],
    signatures: &mut HashMap<String, String>,
) -> Resolution {
    let Some(dir) = dir else {
        return missing("缓存目录不可用；可手动检查本机实例");
    };
    for root in roots {
        if !Path::new(root).is_absolute() {
            continue;
        }
        let signature = signatures
            .entry(root.clone())
            .or_insert_with(|| resource_signature(&sources(Path::new(root))));
        let key_hash = cache_key(root, signature, category, key);
        if let Some(hit) = read_icon_cache(dir, &key_hash) {
            return hit;
        }
    }
    missing("缓存未命中，可手动检查本机实例")
}

#[tauri::command]
pub async fn resolve_stat_icons(
    cache_state: tauri::State<'_, IconCacheDir>,
    args: ResolveStatIconsArgs,
) -> Result<BTreeMap<String, Resolution>, String> {
    let ResolveStatIconsArgs {
        requests,
        cache_only,
    } = args;
    // The cap must not be tied to the statistics page size: it was 100 while
    // `StatisticsPage.page_size` was also 100, so any page-size change (or one
    // extra row) rejected the entire batch with "资源请求超过上限". The frontend
    // now also chunks its requests, so this is a safety limit rather than a
    // budget the UI has to hit exactly.
    const MAX_REQUESTS: usize = 500;
    if requests.len() > MAX_REQUESTS
        || requests
            .iter()
            .any(|r| r.roots.len() > 128 || r.key.len() > 512)
    {
        return Err(format!(
            "资源请求超过上限（最多 {MAX_REQUESTS} 条，本次 {}）",
            requests.len()
        ));
    }
    let cache_dir = cache_state.get();
    tauri::async_runtime::spawn_blocking(move || {
        let mut result = BTreeMap::new();
        if cache_only {
            let mut signatures: HashMap<String, String> = HashMap::new();
            for request in requests {
                let identity = format!("{}:{}", request.category, request.key);
                let answer = lookup_icon_cache_only(
                    cache_dir.as_deref(),
                    &request.category,
                    &request.key,
                    &request.roots,
                    &mut signatures,
                );
                result.insert(identity, answer);
            }
            return Ok(result);
        }
        let mut cache = CACHE
            .get_or_init(Default::default)
            .lock()
            .map_err(|_| "资源缓存锁失败")?;
        let mut grouped: BTreeMap<String, Vec<(String, String, String)>> = BTreeMap::new();
        for request in requests {
            let identity = format!("{}:{}", request.category, request.key);
            result.insert(identity.clone(), missing("没有可读取的来源实例"));
            for root in request.roots {
                if !Path::new(&root).is_absolute() {
                    continue;
                }
                grouped.entry(root).or_default().push((
                    identity.clone(),
                    request.key.clone(),
                    request.category.clone(),
                ));
            }
        }
        for (root, requests) in grouped {
            if requests.iter().all(|(id, _, _)| {
                result
                    .get(id)
                    .is_some_and(|a| a.image.is_some() || a.job.is_some())
            }) {
                continue;
            }
            if !cache
                .get(&root)
                .is_some_and(|i| i.checked.elapsed() < Duration::from_secs(30))
            {
                let previous = cache.remove(&root);
                if cache.len() >= 4 {
                    cache.clear();
                }
                cache.insert(root.clone(), indexed(Path::new(&root), previous));
            }
            let Some(index) = cache.get_mut(&root) else {
                continue;
            };
            // Fresh budget per batch so a long-lived Index still allows a full page.
            index
                .java_attempts
                .store(0, std::sync::atomic::Ordering::Relaxed);
            for (identity, key, category) in requests {
                if result
                    .get(&identity)
                    .is_some_and(|a| a.image.is_some() || a.job.is_some())
                {
                    continue;
                }
                let key_hash = cache_key(&root, &index.signature, &category, &key);
                if let Some(dir) = cache_dir.as_ref() {
                    if let Some(hit) = read_icon_cache(dir, &key_hash) {
                        index.answers.insert(identity.clone(), hit.clone());
                        result.insert(identity, hit);
                        continue;
                    }
                }
                let answer = index.answers.get(&identity).cloned().unwrap_or_else(|| {
                    // A single bad model must not crash the whole check.
                    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        resolve(index, &key, &category)
                    }))
                    .unwrap_or_else(|_| missing("图标解析内部错误，已跳过该条"))
                });
                let answer = attach_job_meta(answer, &key_hash, &root);
                if let Some(dir) = cache_dir.as_ref() {
                    store_resolution_image(dir, &key_hash, &answer);
                }
                if index.answers.len() >= 100 {
                    index.answers.clear();
                }
                index.answers.insert(identity.clone(), answer.clone());
                result.insert(identity, answer);
            }
        }
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}
